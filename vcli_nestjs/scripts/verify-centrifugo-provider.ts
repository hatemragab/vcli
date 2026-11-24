import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile, rm, cp, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Centrifuge } from 'centrifuge';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
import type { PrincipalAuthority } from '../templates/runtime/common/src/core/auth/principal-authority.js';
import type { RealtimeStore } from '../templates/runtime/common/src/core/realtime/realtime-store.js';
import type {
  ApplicationEvent,
  PublicationOutcome,
} from '../templates/runtime/common/src/core/realtime/event-publisher.js';
import { ControlledRealtimeStore } from '../test/realtime-scale-controlled-store.ts';
import { realtimeFixture } from '../test/realtime-scale-fixture.ts';

const images = [
  {
    repository: 'centrifugo/centrifugo',
    tag: 'v6.10.3',
    digest:
      'sha256:116106f9285e6ee129b77eae956c542889e4a6820edcd556c652dbcced171deb',
    compressedBytes: 28042271,
  },
  {
    repository: 'library/redis',
    tag: '7.4.7-alpine',
    digest:
      'sha256:b9f6cf0cab55fdd102fd2182deeae150457943d33439d18c6e2fc5666d3228c1',
    compressedBytes: 17233628,
  },
] as const;
type Case = { name: string; elapsedMs: number; passed: boolean };
type TicketService = {
  issue(
    principal: Principal,
    purpose: 'centrifugo' | 'ws',
  ): Promise<{ ticket: string; expiresAt: number }>;
  close(): void;
};
type ProviderApi = {
  publish(channel: string, event: ApplicationEvent): Promise<string>;
  disconnect(user: string, client: string): Promise<string>;
  close(): void;
};
type Connections = {
  connect(secret: unknown, input: unknown): Promise<unknown>;
  refresh(secret: unknown, input: unknown): Promise<unknown>;
  publish(
    account: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome>;
  sweep(): Promise<void>;
  attach(): Promise<void>;
  close(): Promise<void>;
};
type Connected = { client: Centrifuge; providerClient: string; user: string };
type CallbackFact = {
  kind: 'connect' | 'refresh';
  client: string;
  at: number;
  secretMatches: boolean;
  authorizationPresent: boolean;
  status: number;
};
type ProviderReport = {
  passed: boolean;
  cases: Case[];
  facts: Record<string, unknown>;
  cleanup: boolean;
};
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
async function until(
  check: () => boolean | Promise<boolean>,
  milliseconds: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(50);
  }
  throw new Error('Timed out: ' + label);
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function runCentrifugoProvider(): Promise<ProviderReport> {
  const root = resolve('var/cli-realtime-provider');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const runId = 'vcli-centri-' + randomUUID().slice(0, 8);
  const label = 'vcli.realtime-provider=' + runId;
  const secrets = [
    randomBytes(32).toString('base64url'),
    randomBytes(32).toString('base64url'),
    randomBytes(32).toString('base64url'),
  ];
  const [apiKey, proxySecret, redisPassword] = secrets as [
    string,
    string,
    string,
  ];
  const scrub = (text: string) =>
    secrets.reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      text,
    );
  const report: ProviderReport = {
    passed: false,
    cases: [],
    facts: {
      runId,
      images,
      compressedImageBytes: images.reduce(
        (sum, image) => sum + image.compressedBytes,
        0,
      ),
      transport:
        'real Centrifugo v6.10.3 + authenticated Redis 7.4.7 + Centrifuge5.8 SDK',
      authorityAndPersistence:
        'controlled neutral authority and ControlledRealtimeStore; not native database evidence',
      topology:
        'two 128MiB Centrifugo nodes + 64MiB Redis, internal Docker network, bridge-bound callback peer, no published ports',
    },
    cleanup: false,
  };
  const containers: { id: string; name: string; role: string }[] = [];
  let network: string | undefined,
    callback: Server | undefined,
    tickets: TicketService | undefined;
  const clients = new Set<Centrifuge>(),
    runtimes: Connections[] = [];
  const configPath = resolve(root, 'config-' + runId + '.json');
  async function docker(
    args: string[],
    environment: NodeJS.ProcessEnv = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sudo', ['-n', 'docker', ...args], {
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '',
        error = '';
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, 30000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(output.trim());
        else
          reject(
            new Error(
              scrub('Docker ' + args[0] + ' failed: ' + error + output),
            ),
          );
      });
    });
  }
  async function record(name: string, work: () => Promise<void>) {
    const started = Date.now();
    process.stdout.write('START ' + name + '\n');
    try {
      await work();
      report.cases.push({
        name,
        passed: true,
        elapsedMs: Date.now() - started,
      });
      process.stdout.write('PASS ' + name + '\n');
    } catch (error) {
      report.cases.push({
        name,
        passed: false,
        elapsedMs: Date.now() - started,
      });
      throw error;
    }
  }
  async function request(url: string, options?: RequestInit) {
    return fetch(url, { ...options, signal: AbortSignal.timeout(2500) });
  }
  try {
    // Image manifests were inspected before pulling. Automatic SDK/package installations are prohibited.
    assert.ok(Number(report.facts.compressedImageBytes) < 500000000);
    for (const image of images)
      await docker([
        'image',
        'inspect',
        image.repository + '@' + image.digest,
        '--format',
        '{{.Id}}',
      ]);
    network = await docker([
      'network',
      'create',
      '--internal',
      '--label',
      label,
      runId,
    ]);
    const gateway = await docker([
      'network',
      'inspect',
      network,
      '--format',
      '{{(index .IPAM.Config 0).Gateway}}',
    ]);
    assert.match(gateway, /^(?:10\.|172\.|192\.168\.)[0-9.]+$/);
    const fixture = await realtimeFixture('postgres', root + '/runtime');
    const { WebSocket: NodeWebSocket } = (await import(
      pathToFileURL(fixture.root + '/node_modules/ws/wrapper.mjs').href
    )) as {
      WebSocket: new (
        url: string,
        protocols: string[],
        options: unknown,
      ) => globalThis.WebSocket;
    };
    function TestWebSocket(url: string, protocols: string[]) {
      return new NodeWebSocket(url, protocols, {
        origin: 'http://client.test',
        headers: {
          Authorization: 'Bearer synthetic-client-provider-token',
          'X-Centrifugo-Proxy-Secret': 'forged-client-secret',
        },
      });
    }
    const websocket = TestWebSocket as unknown as typeof globalThis.WebSocket;
    const { ApplicationError } = await fixture.load<{
      ApplicationError: new (code: string, status: number) => Error;
    }>('core/errors/application-error');
    const store = new ControlledRealtimeStore();
    const principals = new Map<string, Principal>();
    const authority: PrincipalAuthority = {
      async verify() {
        throw new Error('No provider identity verification is faked as real');
      },
      async current(sessionId) {
        const current = principals.get(sessionId);
        if (!current) throw new ApplicationError('UNAUTHENTICATED', 401);
        return current;
      },
    };
    const { RealtimeTicketService } = await fixture.load<{
      RealtimeTicketService: new (
        authority: PrincipalAuthority,
        ttl: number,
        store: RealtimeStore,
      ) => TicketService;
    }>('modules/realtime/realtime-ticket.service');
    const { CentrifugoApiService } = await fixture.load<{
      CentrifugoApiService: new (url: string, key: string) => ProviderApi;
    }>('modules/realtime/centrifugo-api.service');
    const { CentrifugoConnectionService } = await fixture.load<{
      CentrifugoConnectionService: new (
        authority: PrincipalAuthority,
        tickets: TicketService,
        store: RealtimeStore,
        api: ProviderApi,
        secret: string,
      ) => Connections;
    }>('modules/realtime/centrifugo-connection.service');
    tickets = new RealtimeTicketService(authority, 30, store);
    const facts: CallbackFact[] = [];
    const wireGrants = new Set<string>(),
      wireClients = new Map<
        string,
        { calls: number; firstFailureAt: number; secondAt: number }
      >();
    const permanent = new Set<string>();
    let peerFailure: Error | undefined;
    function principal(): Principal {
      const result = {
        accountId: randomUUID(),
        sessionId: randomUUID(),
        installationId: randomUUID(),
        installationGeneration: 1,
        expiresAt: Date.now() + 240000,
      };
      principals.set(result.sessionId, result);
      return result;
    }
    callback = createServer((req, res) => {
      void (async () => {
        let body = '';
        for await (const chunk of req) {
          body += String(chunk);
          if (body.length > 16384) {
            res.writeHead(413).end();
            return;
          }
        }
        const input = JSON.parse(body || '{}') as {
          client: string;
          user?: string;
          data?: { ticket?: string };
        };
        const kind = req.url?.endsWith('/refresh') ? 'refresh' : 'connect';
        const fact: CallbackFact = {
          kind,
          client: input.client ?? '',
          at: Date.now(),
          secretMatches:
            req.headers['x-centrifugo-proxy-secret'] === proxySecret,
          authorizationPresent: req.headers.authorization !== undefined,
          status: 200,
        };
        facts.push(fact);
        res.setHeader('content-type', 'application/json');
        const matchedSecret = req.headers['x-centrifugo-proxy-secret'];
        if (
          kind === 'connect' &&
          wireGrants.delete(input.data?.ticket ?? '') &&
          matchedSecret === proxySecret
        ) {
          wireClients.set(input.client, {
            calls: 0,
            firstFailureAt: 0,
            secondAt: 0,
          });
          res.end(
            JSON.stringify({
              result: {
                user: hash('controlled-wire-retry:' + input.client),
                expire_at: Math.floor(Date.now() / 1000) + 2,
              },
            }),
          );
          return;
        }
        const wire = wireClients.get(input.client);
        if (kind === 'refresh' && wire && matchedSecret === proxySecret) {
          wire.calls++;
          if (wire.calls === 1) {
            wire.firstFailureAt = Date.now();
            fact.status = 503;
            res.writeHead(503).end('{}');
          } else {
            wire.secondAt = Date.now();
            res.end(JSON.stringify({ result: { expired: true } }));
          }
          return;
        }
        if (kind === 'refresh' && permanent.has(input.client)) {
          res.end(JSON.stringify({ result: { expired: true } }));
          return;
        }
        const runtime = runtimes[req.url?.startsWith('/b/') ? 1 : 0];
        assert.ok(runtime, 'runtime prepared before public admission');
        try {
          res.end(JSON.stringify(await runtime[kind](matchedSecret, input)));
        } catch (error) {
          assert.ok(
            error &&
              typeof error === 'object' &&
              'status' in error &&
              error.status === 503,
          );
          fact.status = 503;
          res.writeHead(503).end('{}');
        }
      })().catch((error) => {
        peerFailure = error as Error;
        if (!res.headersSent) res.writeHead(500);
        res.end('{}');
      });
    });
    callback.listen(0, gateway);
    await new Promise<void>((resolve, reject) => {
      callback!.once('listening', resolve);
      callback!.once('error', reject);
    });
    const address = callback.address();
    assert.ok(address && typeof address !== 'string');
    const callbackOrigin = 'http://' + gateway + ':' + address.port;
    const config = JSON.parse(
      await readFile(
        'templates/runtime/common/ops/centrifugo/config.json',
        'utf8',
      ),
    ) as {
      engine: unknown;
      client: {
        allowed_origins: string[];
        proxy: Record<string, { endpoint: string }>;
      };
    };
    config.engine = { type: 'redis', redis: {} };
    config.client.allowed_origins = ['http://client.test'];
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    async function createContainer(
      name: string,
      role: string,
      image: string,
      memory: string,
      args: string[],
      env: NodeJS.ProcessEnv = {},
    ) {
      const id = await docker(
        [
          'create',
          '--pull=never',
          '--name',
          name,
          '--network',
          runId,
          '--label',
          label,
          '--label',
          'vcli.role=' + role,
          '--cgroup-parent',
          'orca.slice',
          '--memory',
          memory,
          '--memory-swap',
          memory,
          '--cpus',
          '0.25',
          '--pids-limit',
          '64',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--read-only',
          '--tmpfs',
          '/tmp:rw,nosuid,nodev,size=16m',
          ...args,
          image,
        ],
        env,
      );
      containers.push({ id, name, role });
      await docker(['start', id]);
      return id;
    }
    const redisName = runId + '-redis';
    const redisId = await docker(
      [
        'create',
        '--pull=never',
        '--name',
        redisName,
        '--network',
        runId,
        '--label',
        label,
        '--label',
        'vcli.role=redis',
        '--cgroup-parent',
        'orca.slice',
        '--memory',
        '64m',
        '--memory-swap',
        '64m',
        '--cpus',
        '0.25',
        '--pids-limit',
        '64',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,nosuid,nodev,size=16m',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--env',
        'VCLI_TEST_REDIS_PASSWORD',
        '--entrypoint',
        '/bin/sh',
        images[1].repository + '@' + images[1].digest,
        '-c',
        'exec redis-server --save "" --appendonly no --dir /tmp --maxmemory 32mb --maxmemory-policy noeviction --requirepass "$VCLI_TEST_REDIS_PASSWORD"',
      ],
      { VCLI_TEST_REDIS_PASSWORD: redisPassword },
    );
    containers.push({ id: redisId, name: redisName, role: 'redis' });
    await docker(['start', redisId]);
    await until(
      async () => {
        try {
          return (
            (await docker(
              ['exec', '--env', 'REDISCLI_AUTH', redisId, 'redis-cli', 'PING'],
              { REDISCLI_AUTH: redisPassword },
            )) === 'PONG'
          );
        } catch {
          return false;
        }
      },
      10000,
      'authenticated Redis ready',
    );
    const nodeIds: string[] = [],
      publicOrigins: string[] = [],
      privateOrigins: string[] = [];
    for (const name of ['a', 'b']) {
      const nodeConfig = JSON.parse(JSON.stringify(config)) as typeof config;
      nodeConfig.client.proxy.connect!.endpoint =
        callbackOrigin + '/' + name + '/connect';
      nodeConfig.client.proxy.refresh!.endpoint =
        callbackOrigin + '/' + name + '/refresh';
      const path = configPath + '-' + name;
      await writeFile(path, JSON.stringify(nodeConfig), { mode: 0o644 });
      const env = {
        CENTRIFUGO_HTTP_API_KEY: apiKey,
        CENTRIFUGO_ENGINE_REDIS_ADDRESS:
          'redis://:' + redisPassword + '@' + redisName + ':6379/0',
        CENTRIFUGO_CLIENT_PROXY_CONNECT_HTTP_STATIC_HEADERS: JSON.stringify({
          'X-Centrifugo-Proxy-Secret': proxySecret,
        }),
        CENTRIFUGO_CLIENT_PROXY_REFRESH_HTTP_STATIC_HEADERS: JSON.stringify({
          'X-Centrifugo-Proxy-Secret': proxySecret,
        }),
      };
      const id = await createContainer(
        runId + '-' + name,
        'centrifugo',
        images[0].repository + '@' + images[0].digest,
        '128m',
        [
          '--volume',
          path + ':/centrifugo/config.json:ro',
          ...Object.keys(env).flatMap((key) => ['--env', key]),
        ],
        env,
      );
      nodeIds.push(id);
      const ip = await docker([
        'inspect',
        id,
        '--format',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
      ]);
      publicOrigins.push('http://' + ip + ':8000');
      privateOrigins.push('http://' + ip + ':9000');
      await until(
        async () => {
          try {
            return (await request(privateOrigins.at(-1)! + '/health')).ok;
          } catch {
            return false;
          }
        },
        10000,
        'Centrifugo healthy',
      );
      runtimes.push(
        new CentrifugoConnectionService(
          authority,
          tickets,
          store,
          new CentrifugoApiService(privateOrigins.at(-1)! + '/api', apiKey),
          proxySecret,
        ),
      );
    }
    await Promise.all(runtimes.map((runtime) => runtime.attach()));
    const errors: { code: number; type: string }[] = [];
    async function sdk(node: number, ticket: string): Promise<Connected> {
      const client = new Centrifuge(
        publicOrigins[node]!.replace('http:', 'ws:') + '/connection/websocket',
        {
          websocket,
          data: { ticket },
          headers: {
            Authorization: 'Bearer forged-emulated-provider-token',
            'X-Centrifugo-Proxy-Secret': 'forged-emulated-secret',
          },
          timeout: 3000,
          minReconnectDelay: 50,
          maxReconnectDelay: 100,
        },
      );
      clients.add(client);
      client.on('error', (ctx) => {
        errors.push({ code: ctx.error.code, type: ctx.type });
      });
      const ready = new Promise<Connected>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('SDK admission timed out')),
          5000,
        );
        client.once('connected', (ctx) => {
          clearTimeout(timer);
          resolve({
            client,
            providerClient: ctx.client,
            user: store.connections.get(ctx.client)?.user ?? '',
          });
        });
        client.once('disconnected', (ctx) => {
          clearTimeout(timer);
          reject(new Error('SDK admission denied ' + ctx.code));
        });
      });
      client.connect();
      return ready;
    }
    async function connect(node: number, p: Principal): Promise<Connected> {
      return sdk(node, (await tickets!.issue(p, 'centrifugo')).ticket);
    }
    function event(): ApplicationEvent {
      return {
        id: randomUUID(),
        type: 'provider.changed',
        payload: { revision: 1 },
      };
    }
    async function publication(
      client: Centrifuge,
      input: ApplicationEvent,
      send: () => Promise<PublicationOutcome>,
    ) {
      const received = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          client.off('publication', listener);
          reject(new Error('Provider publication timed out'));
        }, 5000);
        const listener = (ctx: { data: unknown }) => {
          const data = ctx.data as ApplicationEvent;
          if (data.id === input.id) {
            clearTimeout(timer);
            client.off('publication', listener);
            resolve();
          }
        };
        client.on('publication', listener);
      });
      const outcome = await send();
      assert.equal(outcome.status, 'provider-accepted');
      await received;
    }
    await record(
      'pinned provider versions and capped private containers',
      async () => {
        const versions = [
          await docker(['exec', nodeIds[0]!, 'centrifugo', 'version']),
          await docker(['exec', redisId, 'redis-server', '--version']),
        ];
        assert.match(versions[0]!, /6\.10\.3/);
        assert.match(versions[1]!, /7\.4\.7/);
        report.facts.versions = versions;
        for (const container of containers) {
          const values = JSON.parse(
            await docker([
              'inspect',
              container.id,
              '--format',
              '{{json .HostConfig}}',
            ]),
          ) as {
            CgroupParent: string;
            Memory: number;
            NanoCpus: number;
            PidsLimit: number;
            PortBindings: unknown;
          };
          assert.equal(values.CgroupParent, 'orca.slice');
          assert.equal(values.NanoCpus, 250000000);
          assert.equal(values.PidsLimit, 64);
          assert.deepEqual(values.PortBindings, {});
          assert.equal(
            values.Memory,
            (container.role === 'redis' ? 64 : 128) * 1024 * 1024,
          );
        }
        assert.equal(
          await docker([
            'network',
            'inspect',
            network!,
            '--format',
            '{{.Internal}}',
          ]),
          'true',
        );
        assert.equal(
          (
            await request(callbackOrigin + '/a/connect', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'X-Centrifugo-Proxy-Secret': 'forged',
              },
              body: '{}',
            })
          ).status,
          200,
        );
        assert.equal(facts.at(-1)!.secretMatches, false);
      },
    );
    await record(
      'public WebSocket listener excludes private API and health; API key enforced',
      async () => {
        assert.equal(
          (await request(publicOrigins[0]! + '/health')).status,
          404,
        );
        assert.equal(
          (
            await request(publicOrigins[0]! + '/api/publish', {
              method: 'POST',
              body: '{}',
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request(privateOrigins[0]! + '/api/publish', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'X-API-Key': 'wrong',
              },
              body: '{}',
            })
          ).status,
          401,
        );
        assert.equal(
          (await request(privateOrigins[0]! + '/health')).status,
          200,
        );
      },
    );
    const wireGrant = randomBytes(32).toString('base64url');
    wireGrants.add(wireGrant);
    const wire = await sdk(0, wireGrant);
    const retryProof = (async () => {
      await until(
        () => (wireClients.get(wire.providerClient)?.calls ?? 0) >= 1,
        8000,
        'initial wire HTTP503 refresh',
      );
      assert.equal(wire.client.state, 'connected');
      await until(
        () => (wireClients.get(wire.providerClient)?.calls ?? 0) >= 2,
        70000,
        'actual provider one-minute refresh retry',
      );
      const record = wireClients.get(wire.providerClient)!;
      assert.ok(record.secondAt - record.firstFailureAt >= 55000);
      assert.ok(record.secondAt - record.firstFailureAt <= 68000);
      await until(
        () => wire.client.state === 'disconnected',
        5000,
        'expired retry lease denied',
      );
      return record.secondAt - record.firstFailureAt;
    })().then(
      (value) => ({ value }),
      (error) => ({ error: error as Error }),
    );
    const p = principal(),
      first = await connect(0, p),
      other = await connect(1, principal());
    await record(
      'static service secret survives forged transport/emulated headers; no provider auth forwarded',
      async () => {
        const observed = facts.filter((fact) =>
          [first.providerClient, other.providerClient].includes(fact.client),
        );
        assert.ok(observed.length >= 2);
        assert.ok(
          observed.every(
            (fact) => fact.secretMatches && !fact.authorizationPresent,
          ),
        );
        assert.notEqual(first.user, p.accountId);
        assert.match(first.user, /^[a-f0-9]{64}$/);
      },
    );
    await record(
      'Redis engine publishes across two real Centrifugo nodes with authorized exact-client audience',
      async () => {
        let foreign = 0;
        const listener = () => foreign++;
        other.client.on('publication', listener);
        try {
          const input = event();
          await publication(first.client, input, () =>
            runtimes[1]!.publish(p.accountId, input),
          );
          await sleep(150);
          assert.equal(foreign, 0);
        } finally {
          other.client.off('publication', listener);
        }
      },
    );
    await record(
      'server subscriptions only; client publish/subscribe denied by actual provider',
      async () => {
        const binding = await store.binding(first.providerClient);
        assert.ok(binding);
        await assert.rejects(
          first.client.publish(binding.channel, { forged: true }),
        );
        const subscription = first.client.newSubscription('private:forged');
        const denied = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Unauthorized subscription was not denied')),
            4000,
          );
          subscription.once('unsubscribed', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        subscription.subscribe();
        await denied;
        first.client.removeSubscription(subscription);
      },
    );
    await record(
      'purpose mismatch and replay produce real terminal connect denial',
      async () => {
        await assert.rejects(
          sdk(1, (await tickets!.issue(p, 'ws')).ticket),
          /denied 4501/,
        );
        await assert.rejects(sdk(1, 'a'.repeat(43)), /denied 4501/);
        const grant = await tickets!.issue(p, 'centrifugo'),
          once = await sdk(1, grant.ticket);
        once.client.disconnect();
        await assert.rejects(sdk(0, grant.ticket), /denied 4501/);
      },
    );
    await record(
      'actual refresh renews shared lease through either callback API node',
      async () => {
        const before = (await store.binding(first.providerClient))!.expiresAt;
        await until(
          async () =>
            ((await store.binding(first.providerClient))?.expiresAt ?? 0) >
            before,
          9000,
          'refreshed native-shaped lease',
        );
        assert.ok(
          facts.some(
            (fact) =>
              fact.kind === 'refresh' &&
              fact.client === first.providerClient &&
              fact.secretMatches &&
              !fact.authorizationPresent,
          ),
        );
      },
    );
    await record(
      'permanent refresh expired result terminates old lease and cannot replay grant',
      async () => {
        const testClient = await connect(1, principal());
        permanent.add(testClient.providerClient);
        await until(
          () => testClient.client.state === 'disconnected',
          9000,
          'permanent refresh expiry',
        );
        assert.ok(
          facts.some(
            (fact) =>
              fact.kind === 'refresh' &&
              fact.client === testClient.providerClient &&
              fact.status === 200,
          ),
        );
      },
    );
    await record(
      'generation rebind fences hints and exact-user disconnect preserves new generation',
      async () => {
        const current = { ...p, installationGeneration: 2 };
        principals.set(p.sessionId, current);
        const rebound = await connect(1, current);
        await until(
          () => first.client.state === 'disconnected',
          5000,
          'old generation idle revocation',
        );
        assert.notEqual(rebound.user, first.user);
        const oldApi = new CentrifugoApiService(
          privateOrigins[0]! + '/api',
          apiKey,
        );
        try {
          assert.equal(
            await oldApi.disconnect(first.user, first.providerClient),
            'accepted',
          );
        } finally {
          oldApi.close();
        }
        const input = event();
        await publication(rebound.client, input, () =>
          runtimes[0]!.publish(p.accountId, input),
        );
        assert.equal(rebound.client.state, 'connected');
      },
    );
    await record(
      'Redis outage returns unknown and resumes real fanout after recovery',
      async () => {
        const audience = principal(),
          peer = await connect(0, audience);
        await docker(['pause', redisId]);
        try {
          assert.equal(
            (await runtimes[1]!.publish(audience.accountId, event())).status,
            'unknown',
          );
        } finally {
          await docker(['unpause', redisId]);
        }
        await sleep(1500);
        const input = event();
        await publication(peer.client, input, () =>
          runtimes[1]!.publish(audience.accountId, input),
        );
        peer.client.disconnect();
      },
    );
    await record(
      'provider restart requires fresh grant and actual selected SDK client disposes',
      async () => {
        const examplePrincipal = principal();
        let recovered = 0,
          hints = 0;
        // Grant endpoint is a controlled authenticated peer, not a claim of real identity/HTTP integration.
        const grantPeer = createServer((req, res) => {
          void (async () => {
            if (
              req.url !== '/api/realtime/centrifugo-grants' ||
              req.headers.authorization !== 'Bearer synthetic-app-proof'
            ) {
              res.writeHead(401).end();
              return;
            }
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify(
                await tickets!.issue(examplePrincipal, 'centrifugo'),
              ),
            );
          })().catch(() => res.writeHead(503).end());
        });
        grantPeer.listen(0, gateway);
        await new Promise<void>((resolve) =>
          grantPeer.once('listening', resolve),
        );
        const address = grantPeer.address();
        assert.ok(address && typeof address !== 'string');
        const { connectCentrifugo } = (await import(
          pathToFileURL(
            resolve('templates/runtime/common/clients/centrifugo.mjs'),
          ).href
        )) as { connectCentrifugo(options: unknown): { close(): void } };
        const example = connectCentrifugo({
          apiOrigin: 'http://' + gateway + ':' + address.port,
          websocketUrl:
            publicOrigins[1]!.replace('http:', 'ws:') + '/connection/websocket',
          WebSocket: websocket,
          getHeaders: async () => ({
            Authorization: 'Bearer synthetic-app-proof',
          }),
          recover: async () => {
            recovered++;
          },
          onHint: () => {
            hints++;
          },
          onDenied: () => {},
        });
        try {
          await until(() => recovered === 1, 6000, 'example SDK admission');
          await docker(['restart', '-t', '1', nodeIds[1]!]);
          await until(
            () => recovered >= 2,
            12000,
            'fresh grant after provider restart',
          );
          assert.equal(
            (await runtimes[0]!.publish(examplePrincipal.accountId, event()))
              .status,
            'provider-accepted',
          );
          await until(
            () => hints > 0,
            5000,
            'example after restart publication',
          );
          example.close();
          example.close();
          const before = hints;
          await runtimes[0]!.publish(examplePrincipal.accountId, event());
          await sleep(100);
          assert.equal(hints, before);
        } finally {
          example.close();
          grantPeer.closeAllConnections();
          await new Promise<void>((resolve) =>
            grantPeer.close(() => resolve()),
          );
        }
      },
    );
    await record(
      'actual pinned HTTP503 refresh retries after one minute then expires permanently (controlled wire policy)',
      async () => {
        const result = await retryProof;
        if ('error' in result) throw result.error;
        report.facts.refresh503RetryMs = result.value;
      },
    );
    assert.equal(peerFailure, undefined);
    report.facts.callbackChecks = {
      count: facts.length,
      providerRequestsWithCorrectSecret: facts.filter(
        (fact) => fact.secretMatches,
      ).length,
      forwardedAuthorization: facts.filter(
        (fact) => fact.secretMatches && fact.authorizationPresent,
      ).length,
      retry503Count: facts.filter((fact) => fact.status === 503).length,
    };
    report.facts.sdkErrorCodes = errors;
    report.passed = true;
  } catch (error) {
    report.facts.failure = scrub(
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    for (const client of clients) {
      client.removeAllListeners();
      client.disconnect();
    }
    tickets?.close();
    for (const runtime of runtimes) await runtime.close().catch(() => {});
    if (callback) {
      callback.closeAllConnections();
      await new Promise<void>((resolve) => callback!.close(() => resolve()));
    }
    let cleaned = true;
    for (const container of containers.slice().reverse()) {
      try {
        await docker(['unpause', container.id]).catch(() => {});
        const logs = await docker(['logs', '--tail', '80', container.id]).catch(
          () => '',
        );
        await writeFile(
          root +
            '/log-' +
            runId +
            '-' +
            container.role +
            '-' +
            container.id.slice(0, 6) +
            '.txt',
          scrub(logs),
          { mode: 0o600 },
        );
        await docker(['rm', '-f', '-v', container.id]);
      } catch {
        cleaned = false;
      }
    }
    if (network)
      await docker(['network', 'rm', network]).catch(() => {
        cleaned = false;
      });
    await Promise.all(
      [configPath, configPath + '-a', configPath + '-b'].map((path) =>
        rm(path, { force: true }),
      ),
    );
    report.cleanup = cleaned;
    await rm(root + '/result.json', { force: true });
    await writeFile(
      root + '/result.json',
      scrub(JSON.stringify(report, null, 2)) + '\n',
      { mode: 0o600 },
    );
    if (!cleaned) report.passed = false;
  }
  if (!report.cleanup)
    throw new Error(
      'Task resource cleanup failed; inspect task-labelled resources',
    );
  return report;
}

// Host orchestration copies finite owned artifacts into a task-owned test runner.
// Its stdin/stdout carry Docker requests privately, keeping Docker access out of the runner.
export async function verifyCentrifugoProvider(): Promise<ProviderReport> {
  const root = resolve('var/cli-realtime-provider'),
    bundle = root + '/runner-bundle';
  await rm(bundle, { recursive: true, force: true });
  await mkdir(bundle + '/node_modules', { recursive: true });
  const ts = (await import('typescript')).default;
  const fixture = await realtimeFixture('postgres', root + '/compiled');
  const runtimePaths = [
    'modules/realtime/centrifugo-api.service.js',
    'modules/realtime/centrifugo-connection.service.js',
    'modules/realtime/realtime-ticket.service.js',
    'modules/realtime/protocol-validation.js',
    'core/errors/application-error.js',
  ];
  for (const path of runtimePaths) {
    await mkdir(dirname(bundle + '/runtime/' + path), { recursive: true });
    await cp(fixture.root + '/out/' + path, bundle + '/runtime/' + path);
  }
  for (const path of [
    'templates/runtime/common/ops/centrifugo/config.json',
    'templates/runtime/common/clients/centrifugo.mjs',
  ]) {
    await mkdir(dirname(bundle + '/' + path), { recursive: true });
    await cp(path, bundle + '/' + path);
  }
  await writeFile(bundle + '/package.json', '{"type":"module"}');
  await writeFile(
    bundle + '/controlled-store.mjs',
    ts.transpileModule(
      await readFile('test/realtime-scale-controlled-store.ts', 'utf8'),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ES2022,
        },
      },
    ).outputText,
  );
  const packages = new Map<string, string>();
  async function packageDirectory(name: string, from: string): Promise<string> {
    let directory = from;
    while (true) {
      const candidate = join(directory, 'node_modules', name);
      try {
        if ((await stat(candidate + '/package.json')).isFile())
          return candidate;
      } catch {
        /* Try enclosing installed cache. */
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error('Missing cached SDK ' + name);
      directory = parent;
    }
  }
  async function copyPackage(name: string, from: string): Promise<void> {
    const directory = await packageDirectory(name, from);
    const metadata = JSON.parse(
      await readFile(directory + '/package.json', 'utf8'),
    ) as {
      name: string;
      version: string;
      dependencies?: Record<string, string>;
    };
    if (packages.has(name)) {
      assert.equal(
        packages.get(name),
        metadata.version,
        'SDK closure version conflict for ' + name,
      );
      return;
    }
    packages.set(name, metadata.version);
    await mkdir(dirname(bundle + '/node_modules/' + name), { recursive: true });
    await cp(directory, bundle + '/node_modules/' + name, {
      recursive: true,
      dereference: true,
    });
    for (const dependency of Object.keys(metadata.dependencies ?? {}))
      await copyPackage(dependency, directory);
  }
  for (const name of [
    'centrifuge',
    'ws',
    '@nestjs/common',
    'reflect-metadata',
    'rxjs',
    'zod',
  ])
    await copyPackage(name, resolve('.'));
  const owned = await readFile('scripts/verify-centrifugo-provider.ts', 'utf8');
  let source = owned.slice(
    0,
    owned.indexOf('// Host orchestration copies finite'),
  );
  source = source.replace(
    "import { ControlledRealtimeStore } from '../test/realtime-scale-controlled-store.ts';",
    "import {ControlledRealtimeStore} from './controlled-store.mjs';",
  );
  source = source.replace(
    "import { realtimeFixture } from '../test/realtime-scale-fixture.ts';",
    '',
  );
  source = source.replace(
    "const fixture = await realtimeFixture('postgres', root + '/runtime');",
    "const fixture={root:process.cwd(),load:async(path)=>import(pathToFileURL(process.cwd()+'/runtime/'+path+'.js').href)};",
  );
  // Artifact lookup stays inside the private runner; no parent checkout or user home is copied.
  const dockerStart = source.indexOf('  async function docker('),
    dockerEnd = source.indexOf('  async function record(', dockerStart);
  assert.ok(dockerStart > 0 && dockerEnd > dockerStart);
  source =
    source.slice(0, dockerStart) +
    [
      '  let requestId=0;',
      '  const requests=new Map();',
      "  createInterface({input:process.stdin}).on('line',line=>{if(!line.startsWith('VCLI_REPLY '))return;const reply=JSON.parse(line.slice(11));const pending=requests.get(reply.id);if(!pending)return;requests.delete(reply.id);reply.error?pending.reject(new Error(reply.error)):pending.resolve(reply.output);});",
      "  async function docker(args,environment={}){const id=++requestId;return new Promise((resolve,reject)=>{requests.set(id,{resolve,reject});process.stdout.write('VCLI_DOCKER '+JSON.stringify({id,args,environment})+" +
        JSON.stringify(String.fromCharCode(10)) +
        ');});}',
      '',
    ].join(String.fromCharCode(10)) +
    source.slice(dockerEnd);
  source +=
    String.fromCharCode(10) +
    "const result=await runCentrifugoProvider();process.stdout.write('VCLI_RESULT '+JSON.stringify(result)+" +
    JSON.stringify(String.fromCharCode(10)) +
    ');process.exit(0);' +
    String.fromCharCode(10);
  await writeFile(
    bundle + '/runner.mjs',
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
  const runnerName = 'vcli-centri-runner-' + randomUUID().slice(0, 8);
  const runnerImage =
    'library/node@sha256:18a166e2d50578afe933434857ed2d9059bd1aa398a223e9c89eb4302354f079';
  const ids = new Set<string>(),
    networks = new Set<string>();
  let runnerId: string | undefined,
    networkName: string | undefined,
    bootstrap: string | undefined;
  const privateValues: string[] = [];
  const redact = (value: string) =>
    privateValues.reduce(
      (value, secret) => value.replaceAll(secret, '[redacted]'),
      value,
    );
  async function native(
    args: string[],
    environment: NodeJS.ProcessEnv = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sudo', ['-n', 'docker', ...args], {
        env: { ...process.env, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '',
        error = '';
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0
          ? resolve(output.trim())
          : reject(new Error(redact(error + output))),
      );
    });
  }
  let report: ProviderReport | undefined;
  try {
    bootstrap = await native([
      'network',
      'create',
      '--internal',
      '--label',
      'vcli.realtime-provider.runner=' + runnerName,
      runnerName + '-bootstrap',
    ]);
    runnerId = await native([
      'create',
      '--pull=never',
      '--name',
      runnerName,
      '--label',
      'vcli.realtime-provider.runner=' + runnerName,
      '--network',
      runnerName + '-bootstrap',
      '--cgroup-parent',
      'orca.slice',
      '--memory',
      '192m',
      '--memory-swap',
      '192m',
      '--cpus',
      '0.5',
      '--pids-limit',
      '128',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--interactive',
      '--entrypoint',
      'node',
      '--workdir',
      '/work',
      runnerImage,
      '--max-old-space-size=128',
      '/work/runner.mjs',
    ]);
    await native(['cp', bundle + '/.', runnerId + ':/work']);
    const child = spawn('sudo', ['-n', 'docker', 'start', '-ai', runnerId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '',
      rpc = Promise.resolve();
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('VCLI_RESULT ')) {
        report = JSON.parse(line.slice(12)) as ProviderReport;
        return;
      }
      if (!line.startsWith('VCLI_DOCKER ')) {
        process.stdout.write(redact(line) + '\n');
        return;
      }
      const request = JSON.parse(line.slice(12)) as {
        id: number;
        args: string[];
        environment: NodeJS.ProcessEnv;
      };
      rpc = rpc.then(async () => {
        try {
          privateValues.push(
            ...Object.values(request.environment).filter(
              (value): value is string =>
                typeof value === 'string' && value.length > 20,
            ),
          );
          const args = request.args.slice();
          // sudo resets the CLI environment; pass only these test-owned values explicitly.
          // Requests/argv are never logged and failures are redacted before evidence.
          for (let i = 0; i < args.length - 1; i++)
            if (
              args[i] === '--env' &&
              request.environment[args[i + 1]!] !== undefined
            )
              args[i + 1] =
                args[i + 1] + '=' + request.environment[args[i + 1]!]!;
          let configCopy: { source: string; target: string } | undefined;
          if (args[0] === 'create' && args.includes('--volume')) {
            const index = args.indexOf('--volume'),
              parts = args[index + 1]!.split(':');
            configCopy = { source: parts[0]!, target: parts[1]! };
            args.splice(index, 2);
            const readOnly = args.indexOf('--read-only');
            if (readOnly >= 0) args.splice(readOnly, 1);
          }
          if (args[0] === 'network' && args[1] === 'rm')
            await native(['network', 'disconnect', args[2]!, runnerId!]);
          let output: string;
          if (
            args[0] === 'network' &&
            args[1] === 'inspect' &&
            args.at(-1)?.includes('Gateway')
          ) {
            output = await native([
              'inspect',
              runnerId!,
              '--format',
              '{{with index .NetworkSettings.Networks "' +
                networkName +
                '"}}{{.IPAddress}}{{end}}',
            ]);
          } else output = await native(args, request.environment);
          if (args[0] === 'network' && args[1] === 'create') {
            networks.add(output);
            networkName = args.at(-1)!;
            await native(['network', 'connect', output, runnerId!]);
          }
          if (args[0] === 'create') {
            ids.add(output);
            if (configCopy) {
              const temporary =
                root + '/config-transfer-' + hash(configCopy.source) + '.json';
              try {
                await native([
                  'cp',
                  runnerId + ':' + configCopy.source,
                  temporary,
                ]);
                await native([
                  'cp',
                  temporary,
                  output + ':' + configCopy.target,
                ]);
              } finally {
                await rm(temporary, { force: true });
              }
            }
          }
          if (args[0] === 'rm') for (const id of args) ids.delete(id);
          if (args[0] === 'network' && args[1] === 'rm')
            networks.delete(args[2]!);
          child.stdin.write(
            'VCLI_REPLY ' + JSON.stringify({ id: request.id, output }) + '\n',
          );
        } catch (error) {
          child.stdin.write(
            'VCLI_REPLY ' +
              JSON.stringify({
                id: request.id,
                error: redact(
                  error instanceof Error ? error.message : String(error),
                ),
              }) +
              '\n',
          );
        }
      });
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await rpc;
    await rm(root + '/result.json', { force: true });
    await new Promise<void>((resolve, reject) => {
      const archive = spawn(
        'sudo',
        [
          '-n',
          'docker',
          'cp',
          runnerId + ':/work/var/cli-realtime-provider/.',
          '-',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const extract = spawn(
        'tar',
        ['--extract', '--file', '-', '--directory', root, '--no-same-owner'],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      archive.stdout.pipe(extract.stdin);
      let failures = '';
      archive.stderr.on('data', (data: Buffer) => {
        failures += data.toString();
      });
      extract.stderr.on('data', (data: Buffer) => {
        failures += data.toString();
      });
      const done = (process: ReturnType<typeof spawn>) =>
        new Promise<number | null>((resolve, reject) => {
          process.once('error', reject);
          process.once('close', resolve);
        });
      void Promise.all([done(archive), done(extract)]).then((codes) => {
        if (codes.every((code) => code === 0)) resolve();
        else
          reject(
            new Error('Task evidence archive extraction failed: ' + failures),
          );
      }, reject);
    });
    if (code !== 0) throw new Error(redact(stderr));
    assert.ok(report, 'runner returned an explicit result');
    report.facts.runner = {
      image: runnerImage,
      nodeCompressedBytes: 84104018,
      combinedDownloadedBytes: 129379917,
      memoryMiB: 192,
      totalContainerMiB: 512,
      sdkPackages: Object.fromEntries(packages),
    };
    await rm(root + '/result.json', { force: true });
    await writeFile(
      root + '/result.json',
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    return report;
  } finally {
    if (runnerId) await native(['rm', '-f', '-v', runnerId]);
    for (const id of ids) await native(['unpause', id]).catch(() => {});
    for (const id of ids) await native(['rm', '-f', '-v', id]);
    for (const network of networks) await native(['network', 'rm', network]);
    if (bootstrap) await native(['network', 'rm', bootstrap]);
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await verifyCentrifugoProvider();
  process.stdout.write(
    JSON.stringify({
      passed: result.passed,
      cases: result.cases.length,
      cleanup: result.cleanup,
    }) + '\n',
  );
}

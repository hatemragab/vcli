import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { once, EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
import type { PrincipalAuthority } from '../templates/runtime/common/src/core/auth/principal-authority.js';
import type {
  ApplicationEvent,
  PublicationOutcome,
} from '../templates/runtime/common/src/core/realtime/event-publisher.js';
import type { RealtimeStore } from '../templates/runtime/common/src/core/realtime/realtime-store.js';
import { ControlledRealtimeStore } from './realtime-scale-controlled-store.ts';
import { realtimeFixture } from './realtime-scale-fixture.ts';

type Registry = {
  add(connection: {
    id: string;
    principal: Principal;
    send(event: ApplicationEvent): boolean;
    close(): void;
  }): void;
  publish(
    accountId: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome>;
  sweep(): Promise<void>;
  close(): void;
  count(): number;
};
type Tickets = {
  issue(
    principal: Principal,
    purpose: 'ws' | 'centrifugo',
  ): Promise<{ ticket: string; expiresAt: number }>;
  consume(ticket: string, purpose: 'ws' | 'centrifugo'): Promise<Principal>;
  close(): void;
};
type Api = {
  publish(channel: string, event: ApplicationEvent): Promise<string>;
  disconnect(user: string, client: string): Promise<string>;
  close(): void;
};
type Cent = {
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
type Transport = {
  attach(server: Server): Promise<void>;
  close(): Promise<void>;
};
type Peer = EventEmitter & {
  connected: boolean;
  close(): void;
  disconnect(): void;
  send(data: string): void;
  terminate(): void;
  readyState: number;
};
let fixture: Awaited<ReturnType<typeof realtimeFixture>>;
let RegistryClass: new (
  authority: PrincipalAuthority,
  events: { record(input: unknown): void },
  transport: string,
  max?: number,
) => Registry;
let TicketClass: new (
  authority: PrincipalAuthority,
  ttl: number,
  store: RealtimeStore,
) => Tickets;
let ApiClass: new (url: string, key: string) => Api;
let CentClass: new (
  authority: PrincipalAuthority,
  tickets: Tickets,
  store: RealtimeStore,
  api: Api,
  secret: string,
) => Cent;
const events = { record(_input: unknown) {} };
const secret = 's'.repeat(32),
  key = 'k'.repeat(32);
function principal(): Principal {
  return {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    installationGeneration: 1,
    expiresAt: Date.now() + 60000,
  };
}
function auth(p: Principal) {
  let current = p;
  return {
    authority: {
      async verify() {
        return current;
      },
      async current() {
        return current;
      },
    } satisfies PrincipalAuthority,
    set(value: Principal) {
      current = value;
    },
  };
}
function hint(): ApplicationEvent {
  return { id: randomUUID(), type: 'record.changed', payload: { revision: 1 } };
}
async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  if (server.listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
}
function next(peer: EventEmitter, event: string): Promise<unknown[]> {
  return once(peer, event, { signal: AbortSignal.timeout(4000) });
}
before(async () => {
  fixture = await realtimeFixture('postgres');
  RegistryClass = (
    await fixture.load<{ RealtimeService: typeof RegistryClass }>(
      'modules/realtime/realtime.service',
    )
  ).RealtimeService;
  TicketClass = (
    await fixture.load<{ RealtimeTicketService: typeof TicketClass }>(
      'modules/realtime/realtime-ticket.service',
    )
  ).RealtimeTicketService;
  ApiClass = (
    await fixture.load<{ CentrifugoApiService: typeof ApiClass }>(
      'modules/realtime/centrifugo-api.service',
    )
  ).CentrifugoApiService;
  CentClass = (
    await fixture.load<{ CentrifugoConnectionService: typeof CentClass }>(
      'modules/realtime/centrifugo-connection.service',
    )
  ).CentrifugoConnectionService;
});

test('generation changes fence late outbound hints and idle sockets without evicting a replacement', async () => {
  const p = principal(),
    a = auth(p),
    registry = new RegistryClass(a.authority, events, 'ws');
  let sent = 0,
    closed = 0;
  try {
    registry.add({
      id: 'old',
      principal: p,
      send: () => {
        sent++;
        return true;
      },
      close: () => closed++,
    });
    a.set({ ...p, installationGeneration: 2 });
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'audience-ineligible',
    );
    assert.equal(sent, 0);
    assert.equal(closed, 1);
    registry.add({
      id: 'new',
      principal: { ...p, installationGeneration: 2 },
      send: () => {
        sent++;
        return true;
      },
      close: () => closed++,
    });
    await registry.sweep();
    assert.equal(registry.count(), 1);
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'attempted',
    );
    assert.equal(sent, 1);
  } finally {
    registry.close();
  }
});
test('authority outage fails closed before disclosure and refused sends close exact slow clients', async () => {
  const p = principal(),
    a = auth(p),
    registry = new RegistryClass(a.authority, events, 'socketio');
  let closed = 0;
  try {
    registry.add({
      id: 'slow',
      principal: p,
      send: () => false,
      close: () => closed++,
    });
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'unavailable',
    );
    assert.equal(closed, 1);
    registry.add({
      id: 'expired',
      principal: p,
      send: () => {
        throw new Error('MUST_NOT_SEND');
      },
      close: () => closed++,
    });
    a.authority.current = async () => {
      throw new Error('CONTROLLED_AUTHORITY_OUTAGE');
    };
    await registry.sweep();
    assert.equal(registry.count(), 0);
    assert.equal(closed, 2);
  } finally {
    registry.close();
  }
});
test('ticket service shares hashes across instances and consumes one time with purpose and generation fencing (controlled persistence)', async () => {
  const p = principal(),
    a = auth(p),
    store = new ControlledRealtimeStore(),
    first = new TicketClass(a.authority, 30, store),
    second = new TicketClass(a.authority, 30, store);
  try {
    const issued = await first.issue(p, 'ws');
    assert.ok(!store.tickets.has(issued.ticket));
    await assert.rejects(second.consume(issued.ticket, 'centrifugo'));
    const race = await Promise.allSettled(
      Array.from({ length: 20 }, () => second.consume(issued.ticket, 'ws')),
    );
    assert.equal(race.filter((item) => item.status === 'fulfilled').length, 1);
    const stale = await first.issue(p, 'ws');
    a.set({ ...p, installationGeneration: 2 });
    await assert.rejects(second.consume(stale.ticket, 'ws'));
    await assert.rejects(first.issue(p, 'ws'));
  } finally {
    first.close();
    second.close();
  }
});
test('ticket outstanding/rate limits are exercised against the controlled store, not claimed native', async () => {
  const p = principal(),
    a = auth(p),
    store = new ControlledRealtimeStore(),
    tickets = new TicketClass(a.authority, 30, store);
  try {
    const outstanding = await Promise.all(
      Array.from({ length: 4 }, () => tickets.issue(p, 'ws')),
    );
    await assert.rejects(tickets.issue(p, 'ws'));
    for (const item of outstanding) await tickets.consume(item.ticket, 'ws');
    for (let i = 0; i < 6; i++) {
      const item = await tickets.issue(p, 'ws');
      await tickets.consume(item.ticket, 'ws');
    }
    await assert.rejects(tickets.issue(p, 'ws'));
  } finally {
    tickets.close();
  }
});
test('real Socket.IO client admits, acknowledges ping, receives private hint, rejects forged audience and drains', async () => {
  const { SocketIoService } = await fixture.load<{
    SocketIoService: new (
      config: unknown,
      authority: PrincipalAuthority,
      registry: Registry,
    ) => Transport;
  }>('modules/realtime/socket-io.service');
  const { io } = (await import(
    pathToFileURL(
      fixture.root + '/node_modules/socket.io-client/build/esm-debug/index.js',
    ).href
  )) as { io: (url: string, options: unknown) => Peer };
  const p = principal(),
    a = auth(p),
    registry = new RegistryClass(a.authority, events, 'socketio'),
    http = createServer(),
    protocol = new SocketIoService(
      {
        allowedOrigins: ['http://client.test'],
        auth: { driver: 'local' },
        realtime: { path: '/realtime', maxPayloadBytes: 16384 },
      },
      a.authority,
      registry,
    );
  let peer: Peer | undefined;
  try {
    await protocol.attach(http);
    const origin = await listen(http);
    peer = io(origin, {
      path: '/realtime',
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      extraHeaders: { Origin: 'http://client.test' },
      auth: { kind: 'local', accessToken: 'synthetic-proof' },
    });
    const admitted = next(peer, 'admitted');
    (peer as Peer & { connect(): void }).connect();
    await admitted;
    await new Promise<void>((resolve, reject) => {
      peer!.emit('ping', null, (reply: unknown) => {
        try {
          assert.deepEqual(reply, { version: 1, type: 'pong' });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    const received = next(peer, 'notification');
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'attempted',
    );
    await received;
    const disconnected = next(peer, 'disconnect');
    peer.emit('join', { accountId: 'forged' });
    await disconnected;
    assert.equal(registry.count(), 0);
  } finally {
    peer?.close();
    registry.close();
    await protocol.close();
    await close(http);
  }
});
test('real native ws client needs first-frame fresh ticket; replay and old generation are denied', async () => {
  const { NativeWsService } = await fixture.load<{
    NativeWsService: new (
      config: unknown,
      authority: PrincipalAuthority,
      tickets: Tickets,
      registry: Registry,
    ) => Transport;
  }>('modules/realtime/native-ws.service');
  const { WebSocket } = (await import(
    pathToFileURL(fixture.root + '/node_modules/ws/wrapper.mjs').href
  )) as { WebSocket: new (url: string, options: unknown) => Peer };
  const p = principal(),
    a = auth(p),
    store = new ControlledRealtimeStore(),
    tickets = new TicketClass(a.authority, 30, store),
    registry = new RegistryClass(a.authority, events, 'ws'),
    http = createServer();
  const protocol = new NativeWsService(
    {
      allowedOrigins: ['http://client.test'],
      realtime: { path: '/realtime', maxPayloadBytes: 16384 },
    },
    a.authority,
    tickets,
    registry,
  );
  const peers: Peer[] = [];
  try {
    await protocol.attach(http);
    const origin = (await listen(http)).replace('http:', 'ws:');
    const issued = await tickets.issue(p, 'ws');
    const peer = new WebSocket(origin + '/realtime', {
      origin: 'http://client.test',
    });
    peers.push(peer);
    await next(peer, 'open');
    let message = next(peer, 'message');
    peer.send(
      JSON.stringify({
        version: 1,
        type: 'authenticate',
        ticket: issued.ticket,
      }),
    );
    assert.equal(JSON.parse(String((await message)[0])).type, 'admitted');
    message = next(peer, 'message');
    await registry.publish(p.accountId, hint());
    assert.equal(JSON.parse(String((await message)[0])).type, 'notification');
    const replay = new WebSocket(origin + '/realtime', {
      origin: 'http://client.test',
    });
    peers.push(replay);
    await next(replay, 'open');
    const rejected = next(replay, 'close');
    replay.send(
      JSON.stringify({
        version: 1,
        type: 'authenticate',
        ticket: issued.ticket,
      }),
    );
    await rejected;
    const oldClosed = next(peer, 'close');
    a.set({ ...p, installationGeneration: 2 });
    await registry.sweep();
    await oldClosed;
  } finally {
    for (const peer of peers) peer.terminate();
    tickets.close();
    registry.close();
    await protocol.close();
    await close(http);
  }
});
test('Centrifugo private HTTP API preserves unknown acceptance, bounds responses, and sends exact client disconnect', async () => {
  const calls: { path: string; key: unknown; data: unknown }[] = [];
  let mode = 'accepted';
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    calls.push({
      path: req.url!,
      key: req.headers['x-api-key'],
      data: JSON.parse(body),
    });
    res.setHeader('content-type', 'application/json');
    res.end(
      mode === 'accepted'
        ? '{"result":{}}'
        : mode === 'unknown'
          ? '{"error":{"code":100}}'
          : mode === 'oversize'
            ? 'x'.repeat(5000)
            : '{"error":{"code":107}}',
    );
  });
  let api: Api | undefined;
  try {
    api = new ApiClass((await listen(server)) + '/api', key);
    assert.equal(
      await api.publish('private:' + 'a'.repeat(64), hint()),
      'accepted',
    );
    mode = 'unknown';
    assert.equal(await api.publish('private:test', hint()), 'unknown');
    mode = 'oversize';
    assert.equal(await api.publish('private:test', hint()), 'unknown');
    mode = 'rejected';
    assert.equal(await api.publish('private:test', hint()), 'unavailable');
    mode = 'accepted';
    await api.disconnect('generation-user', 'exact-client');
    assert.equal(calls[0]!.key, key);
    assert.deepEqual(calls.at(-1)!.data, {
      user: 'generation-user',
      client: 'exact-client',
      disconnect: { code: 4501, reason: 'authority expired' },
    });
  } finally {
    api?.close();
    await close(server);
  }
});
test('Centrifugo shared callback state, server routing, exact-generation disconnect and version-correct denial/retry shapes', async () => {
  const p = principal(),
    a = auth(p),
    store = new ControlledRealtimeStore(),
    tickets = new TicketClass(a.authority, 30, store);
  const disconnects: { user: string; client: string }[] = [];
  let published = 0;
  const api: Api = {
    async publish() {
      published++;
      return 'accepted';
    },
    async disconnect(user, client) {
      disconnects.push({ user, client });
      return 'accepted';
    },
    close() {},
  };
  const first = new CentClass(a.authority, tickets, store, api, secret),
    second = new CentClass(a.authority, tickets, store, api, secret);
  const client = randomUUID(),
    base = {
      client,
      transport: 'websocket',
      protocol: 'json',
      encoding: 'json',
    };
  try {
    assert.deepEqual(await second.connect('wrong', {}), {
      disconnect: { code: 4501, reason: 'unauthorized' },
    });
    const grant = await tickets.issue(p, 'centrifugo');
    const reply = (await first.connect(secret, {
      ...base,
      data: { ticket: grant.ticket },
    })) as { result: { user: string; subs: Record<string, unknown> } };
    assert.match(reply.result.user, /^[a-f0-9]{64}$/);
    assert.notEqual(reply.result.user, p.accountId);
    assert.equal(Object.keys(reply.result.subs).length, 1);
    assert.ok(
      'result' in
        ((await second.refresh(secret, {
          ...base,
          user: reply.result.user,
        })) as object),
    );
    assert.equal(
      (await second.publish(p.accountId, hint())).status,
      'provider-accepted',
    );
    assert.equal(published, 1);
    a.set({ ...p, installationGeneration: 2 });
    await second.sweep();
    assert.deepEqual(disconnects, [{ user: reply.result.user, client }]);
    assert.equal(store.connections.size, 0);
    assert.deepEqual(
      await first.refresh(secret, { ...base, user: reply.result.user }),
      { result: { expired: true } },
    );
    store.fail = true;
    await assert.rejects(
      second.refresh(secret, { ...base, user: reply.result.user }),
      { status: 503 },
    );
    assert.deepEqual(
      await first.connect(secret, {
        ...base,
        data: { ticket: 'a'.repeat(43) },
      }),
      {
        error: { code: 100, message: 'internal server error', temporary: true },
      },
    );
  } finally {
    store.fail = false;
    tickets.close();
    await first.close();
    await second.close();
  }
});
test('Centrifugo rejects client channels and refresh impostors before private provider publication', async () => {
  const p = principal(),
    a = auth(p),
    store = new ControlledRealtimeStore(),
    tickets = new TicketClass(a.authority, 30, store);
  const api: Api = {
    async publish() {
      throw new Error('MUST_NOT_PUBLISH');
    },
    async disconnect() {
      return 'accepted';
    },
    close() {},
  };
  const protocol = new CentClass(a.authority, tickets, store, api, secret);
  try {
    const grant = await tickets.issue(p, 'centrifugo');
    assert.deepEqual(
      await protocol.connect(secret, {
        client: randomUUID(),
        transport: 'websocket',
        protocol: 'json',
        encoding: 'json',
        data: { ticket: grant.ticket },
        channels: ['private:forged'],
      }),
      { disconnect: { code: 4501, reason: 'unauthorized' } },
    );
    assert.deepEqual(
      await protocol.refresh(secret, {
        client: randomUUID(),
        user: 'a'.repeat(64),
        transport: 'websocket',
        protocol: 'json',
        encoding: 'json',
      }),
      { result: { expired: true } },
    );
    assert.equal(
      (await protocol.publish(p.accountId, hint())).status,
      'audience-ineligible',
    );
  } finally {
    tickets.close();
    await protocol.close();
  }
});

test('Socket.IO cluster reports unknown when native membership sees a node missing from transient adapter discovery', async () => {
  type Cluster = {
    attach(io: unknown, registry: Registry): Promise<void>;
    close(): Promise<void>;
  };
  const { SocketIoClusterService } = await fixture.load<{
    SocketIoClusterService: new (
      store: RealtimeStore,
      configure: (io: unknown) => void,
      max: number,
    ) => Cluster;
  }>('modules/realtime/socket-io-cluster.service');
  const p = principal(),
    a = auth(p),
    registry = new RegistryClass(a.authority, events, 'socketio'),
    store = new ControlledRealtimeStore();
  const io = new EventEmitter() as EventEmitter & {
    serverSideEmitWithAck(name: string, input: unknown): Promise<unknown[]>;
  };
  io.serverSideEmitWithAck = async () => [];
  const cluster = new SocketIoClusterService(store, () => {}, 16384);
  try {
    await cluster.attach(io, registry);
    store.nodeLeases.set(randomUUID(), Date.now() + 5000);
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'unknown',
    );
    io.serverSideEmitWithAck = async () => {
      throw new Error('CONTROLLED_ADAPTER_OUTAGE');
    };
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'unknown',
    );
    store.fail = true;
    assert.equal(
      (await registry.publish(p.accountId, hint())).status,
      'unavailable',
    );
  } finally {
    store.fail = false;
    registry.close();
    await cluster.close();
    assert.equal(store.nodeLeases.size, 1);
  }
});
test('Centrifuge5.8 SDK example performs getData grant, accepts server subscription publication and disposes (controlled wire peer)', async () => {
  const { WebSocketServer, WebSocket } = (await import(
    pathToFileURL(fixture.root + '/node_modules/ws/wrapper.mjs').href
  )) as {
    WebSocketServer: new (options: unknown) => EventEmitter & {
      clients: Set<Peer>;
      close(callback: () => void): void;
    };
    WebSocket: unknown;
  };
  const ticket = 'a'.repeat(43),
    channel = 'private:' + 'b'.repeat(64),
    payload = hint();
  let grantCalls = 0,
    recovered = 0,
    hints = 0,
    denied = 0;
  let resolveHint: () => void = () => {};
  const gotHint = new Promise<void>((resolve) => {
    resolveHint = resolve;
  });
  const server = createServer((req, res) => {
    if (req.url === '/api/realtime/centrifugo-grants') {
      grantCalls++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ticket }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  const wss = new WebSocketServer({ server, path: '/connection/websocket' });
  wss.on('connection', (peer: Peer) => {
    peer.on('message', (bytes: unknown) => {
      for (const line of String(bytes).split('\n')) {
        if (!line) continue;
        const command = JSON.parse(line) as {
          id: number;
          connect?: { data: { ticket: string } };
        };
        if (command.connect) {
          assert.equal(command.connect.data.ticket, ticket);
          peer.send(
            JSON.stringify({
              id: command.id,
              connect: {
                client: randomUUID(),
                version: '6.10.3',
                subs: { [channel]: {} },
                ping: 0,
              },
            }),
          );
          setTimeout(() => {
            if (peer.readyState === 1)
              peer.send(
                JSON.stringify({ push: { channel, pub: { data: payload } } }),
              );
          }, 20);
        }
      }
    });
  });
  let client: { close(): void } | undefined;
  try {
    const origin = await listen(server);
    const { connectCentrifugo } = (await import(
      pathToFileURL(
        process.cwd() + '/templates/runtime/common/clients/centrifugo.mjs',
      ).href
    )) as { connectCentrifugo: (input: unknown) => { close(): void } };
    client = connectCentrifugo({
      apiOrigin: origin,
      websocketUrl: origin.replace('http:', 'ws:') + '/connection/websocket',
      WebSocket,
      getHeaders: async () => ({ authorization: 'Bearer synthetic-proof' }),
      recover: async () => {
        recovered++;
      },
      onHint: (event: unknown) => {
        assert.deepEqual(event, payload);
        hints++;
        resolveHint();
      },
      onDenied: () => denied++,
    });
    await Promise.race([
      gotHint,
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('SDK_PUBLICATION_TIMEOUT')),
          3000,
        );
        timer.unref();
      }),
    ]);
    assert.equal(grantCalls, 1);
    assert.equal(recovered, 1);
    assert.equal(hints, 1);
    assert.equal(denied, 0);
    const peer = [...wss.clients][0]!;
    const disconnected = next(peer, 'close');
    client.close();
    client.close();
    await disconnected;
  } finally {
    client?.close();
    for (const peer of wss.clients) peer.terminate();
    await new Promise<void>((resolve) => wss.close(resolve));
    await close(server);
  }
});

test('late Centrifugo disconnect remains scoped to old generation while rebound client receives current hints', async () => {
  const p = principal(),
    a = auth(p),
    store = new ControlledRealtimeStore(),
    tickets = new TicketClass(a.authority, 30, store);
  let begin: () => void = () => {},
    release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
      begin = resolve;
    }),
    blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
  const disconnected: { user: string; client: string }[] = [];
  const api: Api = {
    async publish() {
      return 'accepted';
    },
    async disconnect(user, client) {
      disconnected.push({ user, client });
      begin();
      await blocked;
      return 'accepted';
    },
    close() {},
  };
  const protocol = new CentClass(a.authority, tickets, store, api, secret);
  const base = { transport: 'websocket', protocol: 'json', encoding: 'json' };
  try {
    const oldGrant = await tickets.issue(p, 'centrifugo'),
      oldClient = randomUUID();
    const oldReply = (await protocol.connect(secret, {
      ...base,
      client: oldClient,
      data: { ticket: oldGrant.ticket },
    })) as { result: { user: string } };
    const rebound = { ...p, installationGeneration: 2 };
    a.set(rebound);
    const sweeping = protocol.sweep();
    await started;
    const freshGrant = await tickets.issue(rebound, 'centrifugo'),
      newClient = randomUUID();
    const freshReply = (await protocol.connect(secret, {
      ...base,
      client: newClient,
      data: { ticket: freshGrant.ticket },
    })) as { result: { user: string } };
    assert.notEqual(freshReply.result.user, oldReply.result.user);
    assert.equal(
      (await protocol.publish(p.accountId, hint())).status,
      'provider-accepted',
    );
    release();
    await sweeping;
    assert.deepEqual(disconnected, [
      { user: oldReply.result.user, client: oldClient },
    ]);
    assert.equal(store.connections.has(newClient), true);
  } finally {
    release();
    tickets.close();
    await protocol.close();
  }
});
test('private refresh controller translates retry into actual HTTP503 exception', async () => {
  const { CentrifugoProxyController } = await fixture.load<{
    CentrifugoProxyController: new (service: unknown) => {
      refresh(secret: unknown, body: unknown): Promise<unknown>;
    };
  }>('modules/realtime/centrifugo-proxy.controller');
  const { ApplicationError } = await fixture.load<{
    ApplicationError: new (code: string, status: number) => Error;
  }>('core/errors/application-error');
  const controller = new CentrifugoProxyController({
    async refresh() {
      throw new ApplicationError('CENTRIFUGO_REFRESH_RETRY', 503);
    },
  });
  await assert.rejects(controller.refresh(secret, {}), (error: unknown) => {
    assert.ok(error && typeof error === 'object' && 'getStatus' in error);
    assert.equal((error.getStatus as () => number)(), 503);
    return true;
  });
});

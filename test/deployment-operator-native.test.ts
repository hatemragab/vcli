import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { ProjectConfig } from '../src/contracts.ts';
import type { DeploymentTarget } from '../src/recipes/service-plan-types.ts';
import type {
  DeploymentPlan,
  OperatorOptions,
  TargetProfile,
} from '../src/deployment/operators/types.ts';

// Controlled native-protocol peers only. Emits an isolated compiler closure, never root/reference dist.
const base = path.resolve('var/cli-deployment-operators');
await mkdir(base, { recursive: true });
const emitted = await mkdtemp(path.join(base, 'compiled-'));
try {
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--ignoreConfig',
      '--strict',
      '--noUncheckedIndexedAccess',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2023',
      '--skipLibCheck',
      '--esModuleInterop',
      '--types',
      'node',
      '--rootDir',
      'src',
      '--outDir',
      emitted,
      'src/deployment/operators/index.ts',
    ],
    { stdio: 'pipe' },
  );
} catch {
  throw new Error('ISOLATED_OPERATOR_COMPILATION_FAILED');
}
const ops: typeof import('../src/deployment/operators/index.ts') = await import(
  pathToFileURL(path.join(emitted, 'deployment/operators/index.js')).href
);
const recipes: typeof import('../src/recipes/service-plan.ts') = await import(
  pathToFileURL(path.join(emitted, 'recipes/service-plan.js')).href
);
test.after(() => rm(emitted, { recursive: true, force: true }));
const operatorOrigin = 'https://operator.example.invalid';
const publicOrigin = 'https://api.example.invalid';
const secret = 'PRIVATE_SENTINEL_7b934cae';
const unrelated = 'CUSTOM_SECRET_PRESERVED';
const sourceCommit = 'a'.repeat(40);
const image = 'registry.example.invalid/test/api@sha256:' + 'b'.repeat(64);
type Row = Record<string, unknown>;
interface Peer {
  profile: TargetProfile;
  options: OperatorOptions;
  requests: {
    pathname: string;
    method: string;
    body: Row;
    headers: IncomingMessage['headers'];
  }[];
  apps: Row[];
  createFailure?: 'before' | 'after' | 'duplicate';
  failStep?: 'environment' | 'configure';
  denied?: boolean;
  badBuild?: boolean;
  badSchema?: boolean;
  badImage?: boolean;
  createCount: number;
  root: string;
}
function row(v: unknown): Row {
  return v as Row;
}
function array(v: unknown): Row[] {
  return v as Row[];
}
async function fixture(
  t: test.TestContext,
  target: DeploymentTarget,
): Promise<Peer> {
  const root = await mkdtemp(path.join(base, target + '-'));
  await chmod(root, 0o700);
  const profile: TargetProfile = {
    schemaVersion: 1,
    target,
    origin: operatorOrigin,
    targetVersion: { dokploy: '0.31.3', coolify: '4.7.5', caprover: '1.16.0' }[
      target
    ],
    scope: {
      namespace:
        target === 'caprover'
          ? 'captain'
          : target === 'coolify'
            ? '7'
            : 'org-1',
      projectId: 'project-1',
      environmentId: target === 'caprover' ? 'preprovisioned' : 'env-1',
      serverId: target === 'caprover' ? 'captain' : 'server-1',
      appName: 'sample-production-api',
      ...(target === 'coolify' ? { destinationId: 'destination-1' } : {}),
    },
    token: secret,
    journalDirectory: root,
    environment: {
      PUBLIC_ORIGIN: publicOrigin,
      ALLOWED_ORIGINS: publicOrigin,
      SESSION_SIGNING_KEYS: secret,
    },
    replaceEnvironmentKeys: [],
    exclusive: {
      quiesced: true,
      evidenceRef: 'ticket:exclusive',
      secretRevisionRef: 'secret-source:v1',
    },
  };
  const peer: Peer = {
    profile,
    options: {},
    requests: [],
    apps: [],
    createCount: 0,
    root,
  };
  const server = createServer((req, res) => {
    void handler(req, res, peer).catch(() => {
      res.statusCode = 500;
      res.end('CONTROLLED_PEER_ERROR');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.ok(
      url.origin === operatorOrigin || url.origin === publicOrigin,
      'fixture denies every other network origin',
    );
    const route =
      url.origin === publicOrigin ? '/public' + url.pathname : url.pathname;
    const response = await fetch(
      'http://127.0.0.1:' + address.port + route + url.search,
      init,
    );
    // Preserve the remote stream/deadlines without claiming loopback HTTP proves provider TLS.
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
  peer.options = { fetch: fetcher, timeoutMs: 3000 };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return peer;
}
function json(res: ServerResponse, data: unknown, cap = false): void {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(cap ? { status: 100, data } : data));
}
async function handler(
  req: IncomingMessage,
  res: ServerResponse,
  p: Peer,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
  const text = Buffer.concat(chunks).toString();
  const body = text ? (JSON.parse(text) as Row) : {};
  const url = new URL(req.url!, operatorOrigin);
  const pathname = url.pathname;
  const method = req.method!;
  const cap = p.profile.target === 'caprover';
  p.requests.push({ pathname, method, body, headers: { ...req.headers } });
  if (pathname.startsWith('/public')) {
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers['x-captain-auth'], undefined);
    json(res, {
      status: 'ready',
      buildId: p.badBuild ? 'c'.repeat(40) : sourceCommit,
      schemaReleaseId: p.badSchema ? 'wrong-release' : 'schema-v1',
    });
    return;
  }
  const credential = cap
    ? req.headers['x-captain-auth']
    : p.profile.target === 'dokploy'
      ? req.headers['x-api-key']
      : String(req.headers.authorization).slice(7);
  assert.equal(credential, secret);
  if (p.denied) {
    if (cap) json(res, { status: 1102, description: secret });
    else {
      res.statusCode = 403;
      json(res, { message: secret });
    }
    return;
  }
  const create =
    method === 'POST' &&
    (pathname === '/api/compose.create' ||
      pathname === '/api/v1/applications/public' ||
      pathname.endsWith('/register/'));
  if (create) {
    p.createCount++;
    if (p.createFailure === 'before') {
      p.createFailure = undefined;
      res.destroy();
      return;
    }
    if (cap) {
      p.apps.push({
        appName: body.appName,
        projectId: body.projectId,
        hasPersistentData: body.hasPersistentData,
        description: '',
        instanceCount: 1,
        containerHttpPort: 80,
        notExposeAsWebApp: false,
        forceSsl: false,
        websocketSupport: false,
        nodeId: '',
        hasDefaultSubDomainSsl: false,
        volumes: [],
        ports: [],
        envVars: [],
        customDomain: [],
        versions: [],
        deployedVersion: 0,
        isAppBuilding: false,
        preDeployFunction: '',
        serviceUpdateOverride: '',
      });
    } else if (p.profile.target === 'dokploy') {
      p.apps.push({
        ...body,
        composeId: 'compose-' + p.createCount,
        appName: String(body.appName) + '-native-suffix',
        autoDeploy: true,
        composePath: 'docker-compose.yml',
        composeStatus: 'idle',
        env: '',
        domains: [],
      });
    } else {
      p.apps.push(coolifyApp(body, 'app-' + p.createCount));
    }
    if (p.createFailure === 'duplicate') {
      p.apps.push({
        ...p.apps[0]!,
        composeId: 'compose-duplicate',
        uuid: 'app-duplicate',
      });
      p.createFailure = undefined;
      res.destroy();
      return;
    }
    if (p.createFailure === 'after') {
      p.createFailure = undefined;
      res.destroy();
      return;
    }
    json(res, cap ? null : p.apps.at(-1), cap);
    return;
  }
  const app = p.apps[0];
  if (p.profile.target === 'dokploy') {
    const name = pathname.slice('/api/'.length);
    if (name === 'settings.getDokployVersion') {
      json(res, p.profile.targetVersion);
      return;
    }
    if (name === 'user.session') {
      json(res, {
        user: { id: 'user-1' },
        session: { activeOrganizationId: p.profile.scope.namespace },
      });
      return;
    }
    if (name === 'user.getPermissions') {
      json(
        res,
        Object.fromEntries(
          [
            'service',
            'deployment',
            'envVars',
            'domain',
            'server',
            'docker',
          ].map((k) => [k, { create: true, read: true, write: true }]),
        ),
      );
      return;
    }
    if (name === 'project.one') {
      json(res, {
        projectId: 'project-1',
        organizationId: p.profile.scope.namespace,
      });
      return;
    }
    if (name === 'environment.one') {
      json(res, {
        environmentId: 'env-1',
        projectId: 'project-1',
        compose: p.apps,
      });
      return;
    }
    if (name === 'server.one') {
      json(res, {
        serverId: 'server-1',
        organizationId: p.profile.scope.namespace,
      });
      return;
    }
    if (name === 'compose.one') {
      json(
        res,
        p.apps.find((a) => a.composeId === url.searchParams.get('composeId')),
      );
      return;
    }
    if (name === 'domain.byComposeId') {
      json(res, app?.domains ?? []);
      return;
    }
    assert.ok(app);
    if (name === 'compose.update') {
      if (p.failStep === 'configure') {
        p.failStep = undefined;
        res.destroy();
        return;
      }
      Object.assign(app, body);
      json(res, app);
      return;
    }
    if (name === 'compose.saveEnvironment') {
      app.env = body.env;
      if (p.failStep === 'environment') {
        p.failStep = undefined;
        res.destroy();
        return;
      }
      json(res, app);
      return;
    }
    if (name === 'domain.create') {
      array(app.domains).push({ ...body, domainId: 'domain-1', enabled: true });
      json(res, null);
      return;
    }
    if (name === 'compose.deploy') {
      app.composeStatus = 'done';
      json(res, true);
      return;
    }
    if (name === 'docker.getContainersByAppNameMatch') {
      const c = JSON.parse(String(app.composeFile)) as Row;
      const count = Number(row(row(row(c.services).api).deploy).replicas);
      json(
        res,
        Array.from({ length: count }, (_, i) => ({
          containerId: 'container-' + i,
          state: 'running',
        })),
      );
      return;
    }
    if (name === 'docker.getConfig') {
      const c = JSON.parse(String(app.composeFile)) as Row;
      const api = row(row(c.services).api);
      json(res, {
        Config: {
          Image: p.badImage ? 'wrong-image' : api.image,
          Env: [secret],
          Labels: {
            ...row(api.labels),
            'com.docker.compose.project': app.appName,
            'com.docker.compose.service': 'api',
          },
        },
        State: { Running: true },
        Mounts: Object.entries(row(c.volumes ?? {})).map(([k, v]) => ({
          Name: row(v).name,
          Destination:
            k === 'app-storage' ? '/app/var/storage' : '/app/var/evidence',
        })),
      });
      return;
    }
  }
  if (p.profile.target === 'coolify') {
    if (pathname === '/api/v1/version') {
      res.end(p.profile.targetVersion);
      return;
    }
    if (pathname === '/api/v1/team') {
      json(res, { id: 7 });
      return;
    }
    if (pathname === '/api/v1/projects/project-1') {
      json(res, { uuid: 'project-1' });
      return;
    }
    if (pathname === '/api/v1/projects/project-1/environments/env-1') {
      json(res, { uuid: 'env-1', applications: p.apps });
      return;
    }
    if (pathname === '/api/v1/servers/server-1/destinations') {
      json(res, [
        { uuid: 'destination-1', server_uuid: 'server-1', type: 'standalone' },
      ]);
      return;
    }
    if (pathname.startsWith('/api/v1/deployments/applications/')) {
      json(res, {
        deployments: [
          {
            commit: p.badImage ? 'c'.repeat(40) : sourceCommit,
            status: 'finished',
            pull_request_id: 0,
          },
        ],
      });
      return;
    }
    assert.ok(app);
    if (pathname.endsWith('/destinations')) {
      json(res, [
        { uuid: 'destination-1', server_uuid: 'server-1', is_primary: true },
      ]);
      return;
    }
    if (pathname.endsWith('/storages')) {
      json(res, { persistent_storages: [], file_storages: [] });
      return;
    }
    if (pathname.endsWith('/envs/bulk')) {
      for (const env of array(body.data)) {
        const existing = array(app.envs).find((e) => e.key === env.key);
        if (existing) Object.assign(existing, env);
        else array(app.envs).push(env);
      }
      if (p.failStep === 'environment') {
        p.failStep = undefined;
        res.destroy();
        return;
      }
      json(res, app.envs);
      return;
    }
    if (pathname.endsWith('/envs')) {
      json(res, app.envs);
      return;
    }
    if (pathname.endsWith('/start')) {
      app.status = 'running:healthy';
      json(res, { deployment_uuid: 'deployment-1' });
      return;
    }
    if (method === 'PATCH') {
      if (p.failStep === 'configure') {
        p.failStep = undefined;
        res.destroy();
        return;
      }
      Object.assign(app, coolifyApp({ ...app, ...body }, String(app.uuid)));
      json(res, app);
      return;
    }
    json(res, app);
    return;
  }
  if (cap) {
    if (pathname === '/api/v2/user/system/info/') {
      json(res, { hasRootSsl: true, rootDomain: 'example.invalid' }, true);
      return;
    }
    if (pathname.endsWith('/versionInfo/')) {
      json(res, { currentVersion: '1.16.0' }, true);
      return;
    }
    if (pathname === '/api/v2/user/system/nodes/') {
      json(
        res,
        { nodes: [{ nodeId: 'node-1', state: 'ready', status: 'active' }] },
        true,
      );
      return;
    }
    if (pathname === '/api/v2/user/projects/') {
      json(res, { projects: [{ id: 'project-1' }] }, true);
      return;
    }
    if (pathname === '/api/v2/user/apps/appDefinitions/') {
      json(
        res,
        {
          rootDomain: 'example.invalid',
          captainSubDomain: 'captain',
          appDefinitions: p.apps,
        },
        true,
      );
      return;
    }
    assert.ok(app);
    if (pathname.endsWith('/update/')) {
      Object.assign(app, body);
      const env = Object.hasOwn(body, 'envVars');
      if (p.failStep === (env ? 'environment' : 'configure')) {
        p.failStep = undefined;
        res.destroy();
        return;
      }
      json(res, null, true);
      return;
    }
    if (pathname.endsWith('/customdomain/')) {
      array(app.customDomain).push({
        publicDomain: body.customDomain,
        hasSsl: false,
      });
      json(res, null, true);
      return;
    }
    if (pathname.endsWith('/enablecustomdomainssl/')) {
      array(app.customDomain).find(
        (d) => d.publicDomain === body.customDomain,
      )!.hasSsl = true;
      json(res, null, true);
      return;
    }
    if (pathname.includes('/appData/')) {
      const captain = JSON.parse(String(body.captainDefinitionContent)) as Row;
      assert.equal(captain.schemaVersion, 2);
      assert.equal(Object.hasOwn(captain, 'services'), false);
      app.deployedVersion = 1;
      app.versions = [
        {
          version: 1,
          deployedImageName: p.badImage ? 'wrong-image' : captain.imageName,
          gitHash: body.gitHash,
        },
      ];
      json(res, null, true);
      return;
    }
  }
  res.statusCode = 404;
  json(res, { error: 'UNEXPECTED_FIXTURE_ENDPOINT' });
}
function coolifyApp(body: Row, id: string): Row {
  const repo = String(body.git_repository);
  const parsed = new URL(
    repo.startsWith('https:') ? repo : 'https://github.com/' + repo,
  );
  const domains = Array.isArray(body.docker_compose_domains)
    ? JSON.stringify(
        Object.fromEntries(
          array(body.docker_compose_domains).map((d) => [
            String(d.name),
            { domain: d.domain },
          ]),
        ),
      )
    : body.docker_compose_domains;
  return {
    ...body,
    uuid: id,
    git_repository:
      parsed.hostname === 'github.com' ? parsed.pathname.slice(1) : parsed.href,
    docker_compose_domains: domains,
    status: body.status ?? 'stopped:exited',
    settings: {
      is_auto_deploy_enabled: false,
      is_preview_deployments_enabled: false,
      is_force_https_enabled: true,
      inject_build_args_to_dockerfile: false,
      redact_all_env_values_in_logs: true,
      include_coolify_default_variables: false,
    },
    envs: body.envs ?? [],
    pre_deployment_command: null,
    post_deployment_command: null,
    docker_compose_custom_start_command: null,
    docker_compose_custom_build_command: null,
  };
}
function services(
  target: DeploymentTarget,
  options: { storage?: boolean; cluster?: boolean } = {},
) {
  const cfg: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'sample', packageManager: 'npm' },
    capabilities: Object.fromEntries(
      [
        'foundation.nest',
        'database.postgres',
        'deployment.' + target,
        ...(options.storage ? ['storage.local'] : []),
      ].map((recipe) => [recipe.split('.')[0]!, { recipe, options: {} }]),
    ),
  };
  return recipes.describeServices(
    cfg,
    [
      { key: 'PUBLIC_ORIGIN', required: true, secret: false },
      { key: 'ALLOWED_ORIGINS', required: true, secret: false },
      { key: 'SESSION_SIGNING_KEYS', required: true, secret: true },
    ],
    {
      environment: 'production',
      externalResources: { database: 'database-1' },
      requireExternalResources: true,
      ...(options.cluster ? { topology: 'cluster', replicas: 2 } : {}),
    },
  );
}
async function plan(
  p: Peer,
  options: { storage?: boolean; cluster?: boolean } = {},
): Promise<DeploymentPlan> {
  if (options.storage && p.profile.target === 'caprover')
    p.profile.scope.nodeId = 'node-1';
  const servicePlan = services(p.profile.target, options);
  return ops.planDeployment(
    servicePlan,
    await ops.discoverDeployment(p.profile, p.options),
    {
      operationId: randomUUID(),
      sourceCommit,
      ...(p.profile.target === 'coolify'
        ? {
            source: {
              repository: 'https://github.com/example/project',
              branch: 'main',
            },
          }
        : { image }),
      schemaReleaseId: 'schema-v1',
      readinessUrl: publicOrigin + '/health/ready',
      managedEnvironmentKeys: Object.keys(p.profile.environment),
      preconditions: {
        exclusiveRef: 'ticket:exclusive',
        secretRevisionRef: 'secret-source:v1',
        ingressRef: 'ticket:private-ingress',
        externalResources: { 'database-1': 'ticket:private-db' },
        volumes: Object.fromEntries(
          servicePlan.volumes.map((v) => [
            v.resourceRef,
            'ticket:volume-owner',
          ]),
        ),
        ...(options.storage ? { nodeId: 'node-1' } : {}),
      },
    },
  );
}
async function journalText(p: Peer): Promise<string> {
  return (
    await Promise.all(
      (await readdir(p.root))
        .filter((f) => f.endsWith('.json') || f.endsWith('.binding'))
        .map((f) => readFile(path.join(p.root, f), 'utf8')),
    )
  ).join('\n');
}
function addUnrelatedSecret(p: Peer): void {
  const a = p.apps[0]!;
  if (p.profile.target === 'dokploy')
    a.env = String(a.env) + '\nCUSTOM_SECRET=' + unrelated;
  else if (p.profile.target === 'coolify')
    array(a.envs).push({
      key: 'CUSTOM_SECRET',
      value: unrelated,
      is_preview: false,
    });
  else array(a.envVars).push({ key: 'CUSTOM_SECRET', value: unrelated });
}

for (const target of ['dokploy', 'coolify', 'caprover'] as const) {
  test(
    target +
      ': controlled native create/config/env/domain/deploy and separate public release readiness',
    async (t) => {
      const p = await fixture(t, target);
      const reviewed = await plan(p, { storage: target !== 'coolify' });
      const applied = await ops.applyDeployment(reviewed, p.profile, p.options);
      assert.equal(applied.outcome, 'applied-unverified');
      assert.equal(p.createCount, 1);
      assert.equal(
        (await ops.verifyDeployment(reviewed, p.profile, p.options)).outcome,
        'verified',
      );
      assert.ok(
        p.requests.some((r) => r.pathname.startsWith('/public/health/ready')),
      );
      const published =
        JSON.stringify({
          reviewed,
          applied,
          inspect: await ops.inspectDeployment(reviewed, p.profile, p.options),
        }) + (await journalText(p));
      assert.equal(published.includes(secret), false);
      assert.equal(published.includes(unrelated), false);
      if (target === 'dokploy') {
        const update = p.requests.find(
          (r) => r.pathname === '/api/compose.update',
        )!;
        assert.equal(update.body.composeType, 'docker-compose');
        assert.equal(
          row(JSON.parse(String(update.body.composeFile))).services !==
            undefined,
          true,
        );
      }
      if (target === 'coolify') {
        const create = p.requests.find(
          (r) => r.pathname === '/api/v1/applications/public',
        )!;
        assert.equal(create.body.build_pack, 'dockercompose');
        assert.equal(create.body.git_commit_sha, sourceCommit);
        assert.equal(create.body.base_directory, '/');
        assert.equal(create.body.instant_deploy, false);
        const bulk = p.requests.find((r) => r.pathname.endsWith('/envs/bulk'))!;
        assert.ok(
          array(bulk.body.data).every(
            (e) => e.is_buildtime === false && e.is_runtime === true,
          ),
        );
      }
      if (target === 'caprover') {
        const patch = p.requests.find(
          (r) =>
            r.pathname.endsWith('/update/') &&
            Object.hasOwn(r.body, 'containerHttpPort'),
        )!;
        assert.equal(patch.method, 'PATCH');
        assert.equal(patch.body.containerHttpPort, 3100);
        assert.equal(patch.body.instanceCount, 1);
        assert.equal(patch.body.nodeId, 'node-1');
        assert.equal(Object.hasOwn(patch.body, 'services'), false);
      }
    },
  );
  test(
    target +
      ': timeout after creation is rediscovered without duplicate native creation',
    async (t) => {
      const p = await fixture(t, target);
      const reviewed = await plan(p);
      p.createFailure = 'after';
      assert.equal(
        (await ops.applyDeployment(reviewed, p.profile, p.options)).outcome,
        'applied-unverified',
      );
      assert.equal(p.createCount, 1);
      assert.equal(p.apps.length, 1);
      assert.equal(
        (await ops.applyDeployment(reviewed, p.profile, p.options)).outcome,
        'applied-unverified',
      );
      assert.equal(p.createCount, 1);
    },
  );
  test(
    target +
      ': timeout before creation remains unknown until an explicit settled-request decision',
    async (t) => {
      const p = await fixture(t, target);
      const reviewed = await plan(p);
      p.createFailure = 'before';
      await assert.rejects(
        ops.applyDeployment(reviewed, p.profile, p.options),
        /NATIVE_OUTCOME_UNKNOWN/,
      );
      await assert.rejects(
        ops.applyDeployment(reviewed, p.profile, p.options),
        /UNKNOWN_OPERATION_RECONCILIATION_REQUIRED/,
      );
      assert.equal(p.createCount, 1);
      const inspection = await ops.inspectDeployment(
        reviewed,
        p.profile,
        p.options,
      );
      assert.equal(inspection.summary?.outcome, 'unknown');
      await ops.reconcileDeployment(
        reviewed,
        p.profile,
        {
          quiesced: true,
          expectedPlanId: reviewed.id,
          expectedStep: 'create',
          expectedFingerprint: inspection.snapshot.fingerprint,
          decision: 'retry',
          evidenceRef: 'ticket:old-request-stopped',
        },
        p.options,
      );
      await ops.applyDeployment(reviewed, p.profile, p.options);
      assert.equal(p.createCount, 2);
      assert.equal(p.apps.length, 1);
    },
  );
  test(
    target +
      ': changed settings reject an existing-resource plan before its first managed write',
    async (t) => {
      const p = await fixture(t, target);
      const first = await plan(p);
      await ops.applyDeployment(first, p.profile, p.options);
      await ops.verifyDeployment(first, p.profile, p.options);
      addUnrelatedSecret(p);
      const reviewed = await plan(p);
      if (target === 'dokploy') p.apps[0]!.autoDeploy = true;
      else if (target === 'coolify') p.apps[0]!.base_directory = '/different';
      else p.apps[0]!.instanceCount = 2;
      const writes = p.requests.filter((r) => r.method !== 'GET').length;
      await assert.rejects(
        ops.applyDeployment(
          reviewed,
          {
            ...p.profile,
            replaceEnvironmentKeys: Object.keys(p.profile.environment),
          },
          p.options,
        ),
        /STALE_REMOTE_SETTINGS/,
      );
      assert.equal(p.requests.filter((r) => r.method !== 'GET').length, writes);
    },
  );
  test(
    target +
      ': replacing only deliberate managed keys preserves unrelated native secrets',
    async (t) => {
      const p = await fixture(t, target);
      const first = await plan(p);
      await ops.applyDeployment(first, p.profile, p.options);
      await ops.verifyDeployment(first, p.profile, p.options);
      addUnrelatedSecret(p);
      const reviewed = await plan(p);
      await ops.applyDeployment(
        reviewed,
        {
          ...p.profile,
          replaceEnvironmentKeys: Object.keys(p.profile.environment),
        },
        p.options,
      );
      const a = p.apps[0]!;
      const privateEnv =
        target === 'dokploy'
          ? String(a.env)
          : JSON.stringify(target === 'coolify' ? a.envs : a.envVars);
      assert.ok(privateEnv.includes(unrelated));
      assert.equal((await journalText(p)).includes(unrelated), false);
    },
  );
  test(
    target +
      ': authority denial is fixed and private token/provider error content is never surfaced',
    async (t) => {
      const p = await fixture(t, target);
      p.denied = true;
      await assert.rejects(
        ops.discoverDeployment(p.profile, p.options),
        (e) =>
          e instanceof Error &&
          e.message === 'DEPLOYMENT_AUTHORITY_DENIED' &&
          !JSON.stringify(e).includes(secret),
      );
      assert.equal(p.createCount, 0);
    },
  );
  test(
    target +
      ': native image/source, build metadata and schema release mismatch independently deny verification',
    async (t) => {
      const p = await fixture(t, target);
      const reviewed = await plan(p);
      await ops.applyDeployment(reviewed, p.profile, p.options);
      if (target === 'caprover')
        row(array(p.apps[0]!.versions)[0]).deployedImageName = 'wrong-image';
      else p.badImage = true;
      await assert.rejects(
        ops.verifyDeployment(reviewed, p.profile, p.options),
        /NATIVE_RELEASE_IDENTITY_MISMATCH/,
      );
      if (target === 'caprover')
        row(array(p.apps[0]!.versions)[0]).deployedImageName = image;
      else p.badImage = false;
      p.badBuild = true;
      await assert.rejects(
        ops.verifyDeployment(reviewed, p.profile, p.options),
        /READINESS_RELEASE_IDENTITY_MISMATCH/,
      );
      p.badBuild = false;
      p.badSchema = true;
      await assert.rejects(
        ops.verifyDeployment(reviewed, p.profile, p.options),
        /READINESS_RELEASE_IDENTITY_MISMATCH/,
      );
    },
  );
}

test('controlled Dokploy duplicate discovery after lost create acknowledgement stays unknown and never creates again', async (t) => {
  const p = await fixture(t, 'dokploy');
  const reviewed = await plan(p);
  p.createFailure = 'duplicate';
  await assert.rejects(ops.applyDeployment(reviewed, p.profile, p.options));
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /AMBIGUOUS_RESOURCE_DISCOVERY/,
  );
  assert.equal(p.createCount, 1);
  assert.equal(p.apps.length, 2);
});
test('controlled Coolify interrupted private environment step requires reconciliation; restart preserves resource and completed steps', async (t) => {
  const p = await fixture(t, 'coolify');
  const reviewed = await plan(p);
  p.failStep = 'environment';
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /NATIVE_OUTCOME_UNKNOWN/,
  );
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /UNKNOWN_OPERATION_RECONCILIATION_REQUIRED/,
  );
  const inspection = await ops.inspectDeployment(
    reviewed,
    p.profile,
    p.options,
  );
  assert.deepEqual(
    inspection.summary?.steps.slice(0, 2).map((s) => s.state),
    ['completed', 'completed'],
  );
  await assert.rejects(
    ops.reconcileDeployment(
      reviewed,
      p.profile,
      {
        quiesced: true,
        expectedPlanId: reviewed.id,
        expectedStep: 'environment',
        expectedFingerprint: 'f'.repeat(64),
        decision: 'completed',
        evidenceRef: 'ticket:private-env-checked',
      },
      p.options,
    ),
    /STALE_RECONCILIATION_DECISION/,
  );
  await ops.reconcileDeployment(
    reviewed,
    p.profile,
    {
      quiesced: true,
      expectedPlanId: reviewed.id,
      expectedStep: 'environment',
      expectedFingerprint: inspection.snapshot.fingerprint,
      decision: 'completed',
      evidenceRef: 'ticket:private-env-checked',
    },
    p.options,
  );
  await ops.applyDeployment(reviewed, p.profile, p.options);
  assert.equal(p.createCount, 1);
  assert.equal(
    p.requests.filter((r) => r.pathname.endsWith('/envs/bulk')).length,
    1,
  );
});
test('private profile nofollow/ownership/mode validation and no ambient credential inheritance', async (t) => {
  const p = await fixture(t, 'caprover');
  const file = path.join(p.root, 'target-profile');
  await writeFile(file, JSON.stringify(p.profile), { mode: 0o600 });
  assert.equal((await ops.loadTargetProfile(file)).token, secret);
  await chmod(file, 0o644);
  await assert.rejects(ops.loadTargetProfile(file), /UNSAFE_PRIVATE_FILE/);
  await chmod(file, 0o600);
  await symlink(file, path.join(p.root, 'link'));
  await assert.rejects(
    ops.loadTargetProfile(path.join(p.root, 'link')),
    /PRIVATE_FILE_UNAVAILABLE/,
  );
  await assert.rejects(
    ops.discoverDeployment(
      { ...p.profile, origin: 'http://operator.example.invalid' },
      p.options,
    ),
    /INVALID_HTTPS_TARGET/,
  );
  await assert.rejects(
    ops.discoverDeployment({ ...p.profile, token: '' }, p.options),
    /INVALID_PRIVATE_TARGET_PROFILE/,
  );
});
test('source-only profile rejects missing schema/external/volume/ingress evidence, unsupported clusters and stale private scope', async (t) => {
  const p = await fixture(t, 'dokploy');
  const reviewed = await plan(p);
  for (const mutate of [
    (f: DeploymentPlan['release']) => {
      delete f.schemaReleaseId;
    },
    (f: DeploymentPlan['release']) => {
      f.preconditions.externalResources = {};
    },
    (f: DeploymentPlan['release']) => {
      f.preconditions.ingressRef = '';
    },
  ]) {
    const facts = structuredClone(reviewed.release);
    mutate(facts);
    assert.throws(() =>
      ops.planDeployment(reviewed.services, reviewed.snapshot, facts),
    );
  }
  assert.throws(
    () => services('dokploy', { storage: true, cluster: true }),
    /UNSUPPORTED_SERVICE_TOPOLOGY/,
  );
  const scaled = await plan(p, { cluster: true });
  assert.equal(scaled.services.replicas, 2);
  assert.ok(scaled.services.pending.some((s) => s.includes('Generation-only')));
  await assert.rejects(
    ops.applyDeployment(
      reviewed,
      { ...p.profile, scope: { ...p.profile.scope, projectId: 'different' } },
      p.options,
    ),
    /DEPLOYMENT_SCOPE_MISMATCH/,
  );
  assert.equal(p.createCount, 0);
});
test('native transport refuses redirects, response overflow, origin drift and unreviewed version before mutation', async (t) => {
  const p = await fixture(t, 'dokploy');
  for (const response of [
    () => new Response('x'.repeat(1024 * 1024 + 1)),
    () => new Response('{}', { status: 302 }),
  ])
    await assert.rejects(
      ops.discoverDeployment(p.profile, { fetch: async () => response() }),
    );
  const drift = new Response('"0.31.3"');
  Object.defineProperty(drift, 'url', {
    value: 'https://different.invalid/api',
  });
  await assert.rejects(
    ops.discoverDeployment(p.profile, { fetch: async () => drift }),
    /TARGET_ORIGIN_DRIFT/,
  );
  await assert.rejects(
    ops.discoverDeployment(p.profile, {
      fetch: async () => new Response('"0.31.4"'),
    }),
    /UNSUPPORTED_TARGET_VERSION/,
  );
  assert.equal(p.createCount, 0);
});

test('strict public unknown-input parsers, private load/save and pure previews preserve their boundaries', async (t) => {
  const p = await fixture(t, 'dokploy');
  const reviewed = await plan(p);
  const calls = p.requests.length;
  const files = await readdir(p.root);
  assert.deepEqual(
    ops.parseDeploymentPlan(JSON.parse(JSON.stringify(reviewed))),
    reviewed,
  );
  ops.assertDeploymentProfile(reviewed, p.profile);
  assert.equal(p.requests.length, calls);
  assert.deepEqual(await readdir(p.root), files);
  assert.throws(
    () => ops.parseDeploymentPlan({ ...reviewed, credentials: secret }),
    /INVALID_DEPLOYMENT_PLAN/,
  );
  assert.throws(
    () => ops.parseDeploymentPlan({ ...reviewed, id: 'f'.repeat(64) }),
    /STALE_OR_TAMPERED_DEPLOYMENT_PLAN/,
  );
  assert.throws(
    () => ops.parseReleaseFacts({ ...reviewed.release, sourceCommit: 'HEAD' }),
    /INVALID_RELEASE_FACTS/,
  );
  assert.throws(
    () =>
      ops.parseReleaseFacts({
        ...reviewed.release,
        readinessUrl: 'https://user:private@api.example.invalid/health/ready',
      }),
    /INVALID_HTTPS_TARGET/,
  );
  assert.throws(
    () =>
      ops.parseServicePlan({ ...reviewed.services, secrets: { KEY: secret } }),
    /INVALID_SERVICE_PLAN/,
  );
  assert.throws(
    () => ops.parseReconciliationDecision({ quiesced: false }),
    /INVALID_RECONCILIATION_DECISION/,
  );
  const file = path.join(p.root, 'saved-plan');
  await ops.saveDeploymentPlan(file, reviewed);
  assert.deepEqual(await ops.loadDeploymentPlan(file), reviewed);
  await assert.rejects(
    ops.saveDeploymentPlan(file, reviewed),
    /PUBLIC_PLAN_FILE_NOT_SAVED/,
  );
  const savedSnapshot = path.join(p.root, 'saved-snapshot');
  await ops.saveDeploymentSnapshot(savedSnapshot, reviewed.snapshot);
  assert.deepEqual(
    await ops.loadDeploymentSnapshot(savedSnapshot),
    reviewed.snapshot,
  );
  await symlink(file, path.join(p.root, 'save-link'));
  await assert.rejects(
    ops.saveDeploymentPlan(path.join(p.root, 'save-link'), reviewed),
    /PUBLIC_PLAN_FILE_NOT_SAVED/,
  );
  await chmod(file, 0o644);
  await assert.rejects(ops.loadDeploymentPlan(file), /UNSAFE_PRIVATE_FILE/);
  assert.equal(p.requests.length, calls);
});
test('source-only long project metadata and finite Firebase cleanup job agree with O0 selected contracts', async (t) => {
  const p = await fixture(t, 'dokploy');
  const cfg: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'a'.repeat(64), packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: 'database.postgres', options: {} },
      auth: {
        recipe: 'auth.firebase',
        options: { methods: ['email-password'], actionDelivery: 'provider' },
      },
      deployment: { recipe: 'deployment.dokploy', options: {} },
    },
  };
  const servicePlan = recipes.describeServices(
    cfg,
    [
      { key: 'PUBLIC_ORIGIN', required: true, secret: false },
      { key: 'ALLOWED_ORIGINS', required: true, secret: false },
      { key: 'SESSION_SIGNING_KEYS', required: true, secret: true },
    ],
    {
      externalResources: { database: 'database-1', firebase: 'firebase-1' },
      requireExternalResources: true,
    },
  );
  assert.equal(ops.parseServicePlan(servicePlan).project.length, 64);
  assert.ok(servicePlan.jobs.some((j) => j.id === 'identity-cleanup'));
  const reviewed = await plan(p);
  const servicesWithJob = {
    ...reviewed.services,
    jobs: [
      ...reviewed.services.jobs,
      {
        id: 'identity-cleanup' as const,
        command: ['node', 'dist/drain-identity-cleanup.js', '--limit', '10'],
        scheduler: 'operator' as const,
        concurrency: 'bounded-cas-lease' as const,
        restart: 'no' as const,
        dependsOn: ['database'],
      },
    ],
  };
  const bound = ops.planDeployment(
    servicesWithJob,
    reviewed.snapshot,
    reviewed.release,
  );
  await ops.applyDeployment(bound, p.profile, p.options);
  assert.equal(p.createCount, 1);
  const compose = JSON.parse(String(p.apps[0]!.composeFile)) as Row;
  assert.deepEqual(row(row(compose.services)['identity-cleanup']).command, [
    'node',
    'dist/drain-identity-cleanup.js',
    '--limit',
    '10',
  ]);
  const bad = structuredClone(servicesWithJob);
  bad.jobs[1]!.command = ['node', 'dist/arbitrary.js'];
  assert.throws(
    () => ops.planDeployment(bad, reviewed.snapshot, reviewed.release),
    /UNSUPPORTED_OPERATOR_JOB/,
  );
});
test('creation intent binding prevents a new plan from bypassing an unresolved previous create', async (t) => {
  const p = await fixture(t, 'dokploy');
  const first = await plan(p);
  p.createFailure = 'before';
  await assert.rejects(ops.applyDeployment(first, p.profile, p.options));
  const second = await plan(p);
  await assert.rejects(
    ops.applyDeployment(second, p.profile, p.options),
    /PREVIOUS_OPERATION_RECONCILIATION_REQUIRED/,
  );
  assert.equal(p.createCount, 1);
});
test('orphaned private lock and incomplete journal require exact quiesced recovery, then resume the same native app', async (t) => {
  const p = await fixture(t, 'coolify');
  const reviewed = await plan(p);
  p.failStep = 'environment';
  await assert.rejects(ops.applyDeployment(reviewed, p.profile, p.options));
  const names = await readdir(p.root);
  const binding = names.find((n) => n.endsWith('.binding'))!;
  const lockFile = path.join(p.root, binding.replace(/\.binding$/, '.lock'));
  const lockId = randomUUID();
  const journalFile = path.join(p.root, reviewed.id + '.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8')) as Row;
  array(journal.steps).find((s) => s.name === 'environment')!.state =
    'incomplete';
  await writeFile(journalFile, JSON.stringify(journal), { mode: 0o600 });
  await writeFile(
    lockFile,
    JSON.stringify({ id: lockId, planId: reviewed.id }),
    { mode: 0o600 },
  );
  const calls = p.requests.length;
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /DEPLOYMENT_LOCK_HELD_RECONCILIATION_REQUIRED/,
  );
  assert.equal(p.requests.length, calls);
  const observed = await ops.inspectDeployment(reviewed, p.profile, p.options);
  assert.equal(observed.lockId, lockId);
  const decision = {
    quiesced: true as const,
    expectedPlanId: reviewed.id,
    expectedStep: 'environment' as const,
    expectedFingerprint: observed.snapshot.fingerprint,
    expectedLockId: lockId,
    decision: 'completed' as const,
    evidenceRef: 'ticket:stopped-old-runner-inspected-private-env',
  };
  await assert.rejects(
    ops.reconcileDeployment(
      reviewed,
      p.profile,
      { ...decision, expectedLockId: randomUUID() },
      p.options,
    ),
    /DEPLOYMENT_LOCK_ID_MISMATCH/,
  );
  await ops.reconcileDeployment(reviewed, p.profile, decision, p.options);
  await ops.applyDeployment(reviewed, p.profile, p.options);
  assert.equal(p.createCount, 1);
  assert.equal(
    p.requests.filter((r) => r.pathname.endsWith('/envs/bulk')).length,
    1,
  );
});
test('acknowledged but unapplied native configuration is unknown rather than reported applied', async (t) => {
  const p = await fixture(t, 'dokploy');
  const reviewed = await plan(p);
  const transport = p.options.fetch!;
  p.options.fetch = async (input, init) => {
    if (String(input).includes('/compose.update')) return new Response('{}');
    return transport(input, init);
  };
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /NATIVE_SETTINGS_NOT_APPLIED/,
  );
  const observed = await ops.inspectDeployment(reviewed, p.profile, p.options);
  assert.equal(
    observed.summary?.steps.find((s) => s.name === 'configure')?.state,
    'unknown',
  );
  assert.equal(
    p.requests.some((r) => r.pathname === '/api/compose.deploy'),
    false,
  );
});
test('known secret-key collisions fail pure profile validation before any managed native mutation', async (t) => {
  const p = await fixture(t, 'caprover');
  const first = await plan(p);
  await ops.applyDeployment(first, p.profile, p.options);
  await ops.verifyDeployment(first, p.profile, p.options);
  const reviewed = await plan(p);
  const writes = p.requests.filter((r) => r.method !== 'GET').length;
  assert.throws(
    () => ops.assertDeploymentProfile(reviewed, p.profile),
    /EXPLICIT_SECRET_REPLACEMENT_REQUIRED/,
  );
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /EXPLICIT_SECRET_REPLACEMENT_REQUIRED/,
  );
  assert.equal(p.requests.filter((r) => r.method !== 'GET').length, writes);
});
test('stale pending step requires explicit fingerprint rebase instead of an implicit overwrite', async (t) => {
  const p = await fixture(t, 'caprover');
  const first = await plan(p);
  await ops.applyDeployment(first, p.profile, p.options);
  await ops.verifyDeployment(first, p.profile, p.options);
  const reviewed = await plan(p);
  const privateProfile = {
    ...p.profile,
    replaceEnvironmentKeys: Object.keys(p.profile.environment),
  };
  p.apps[0]!.instanceCount = 2;
  await assert.rejects(
    ops.applyDeployment(reviewed, privateProfile, p.options),
    /STALE_REMOTE_SETTINGS/,
  );
  const observed = await ops.inspectDeployment(
    reviewed,
    privateProfile,
    p.options,
  );
  await ops.reconcileDeployment(
    reviewed,
    privateProfile,
    {
      quiesced: true,
      expectedPlanId: reviewed.id,
      expectedStep: 'configure',
      expectedFingerprint: observed.snapshot.fingerprint,
      decision: 'retry',
      evidenceRef: 'ticket:reviewed-latest-native-settings',
    },
    p.options,
  );
  await ops.applyDeployment(reviewed, privateProfile, p.options);
  assert.equal(p.apps[0]!.instanceCount, 1);
  assert.equal(p.createCount, 1);
});
test('existing durable volume identities cannot be rebound to another named resource in a new plan', async (t) => {
  const p = await fixture(t, 'dokploy');
  const first = await plan(p, { storage: true });
  await ops.applyDeployment(first, p.profile, p.options);
  await ops.verifyDeployment(first, p.profile, p.options);
  const observed = await ops.discoverDeployment(p.profile, p.options);
  const changed = structuredClone(first.services);
  changed.volumes[0]!.resourceRef = 'replacement-private-volume';
  const facts = structuredClone(first.release);
  facts.operationId = randomUUID();
  facts.preconditions.volumes = {
    'replacement-private-volume': 'ticket:volume',
  };
  assert.throws(
    () => ops.planDeployment(changed, observed, facts),
    /DURABLE_VOLUME_IDENTITY_MISMATCH/,
  );
  assert.equal(p.createCount, 1);
});

test('Dokploy permission matrix, Coolify team, CapRover project and root SSL scope negatives deny before mutation', async (t) => {
  for (const target of ['dokploy', 'coolify', 'caprover'] as const) {
    const p = await fixture(t, target);
    const transport = p.options.fetch!;
    p.options.fetch = async (input, init) => {
      const name = new URL(String(input)).pathname;
      if (target === 'dokploy' && name === '/api/user.getPermissions')
        return new Response(
          JSON.stringify({ service: { read: true, create: false } }),
        );
      if (target === 'coolify' && name === '/api/v1/team')
        return new Response(JSON.stringify({ id: 8 }));
      if (target === 'caprover' && name === '/api/v2/user/projects/')
        return new Response(
          JSON.stringify({
            status: 100,
            data: { projects: [{ id: 'different-project' }] },
          }),
        );
      return transport(input, init);
    };
    await assert.rejects(
      ops.discoverDeployment(p.profile, p.options),
      target === 'dokploy'
        ? /DEPLOYMENT_AUTHORITY_DENIED/
        : /DEPLOYMENT_SCOPE_MISMATCH/,
    );
    assert.equal(p.createCount, 0);
    if (target === 'caprover') {
      p.options.fetch = async (input, init) =>
        new URL(String(input)).pathname === '/api/v2/user/system/info/'
          ? new Response(
              JSON.stringify({ status: 100, data: { hasRootSsl: false } }),
            )
          : transport(input, init);
      await assert.rejects(
        ops.discoverDeployment(p.profile, p.options),
        /CAPROVER_ROOT_SSL_PRECONDITION_REQUIRED/,
      );
      assert.equal(p.createCount, 0);
    }
  }
});
test('authority loss after identified creation preserves partial progress and never rolls back or repeats creation', async (t) => {
  const p = await fixture(t, 'caprover');
  const reviewed = await plan(p);
  const transport = p.options.fetch!;
  p.options.fetch = async (input, init) =>
    new URL(String(input)).pathname.endsWith('/update/')
      ? new Response(JSON.stringify({ status: 1102, description: secret }))
      : transport(input, init);
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    (e) =>
      e instanceof ops.DeploymentOperatorError &&
      e.code === 'DEPLOYMENT_AUTHORITY_DENIED' &&
      e.summary?.resourceId === p.profile.scope.appName &&
      e.summary.steps[0]?.state === 'completed',
  );
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /UNKNOWN_OPERATION_RECONCILIATION_REQUIRED/,
  );
  assert.equal(p.createCount, 1);
  assert.equal(p.apps.length, 1);
  assert.equal(
    p.requests.some((r) => r.pathname.includes('delete')),
    false,
  );
});
test('Coolify duplicate native name discovery refuses ambiguous recovery without a second create', async (t) => {
  const p = await fixture(t, 'coolify');
  const reviewed = await plan(p);
  p.createFailure = 'duplicate';
  await assert.rejects(ops.applyDeployment(reviewed, p.profile, p.options));
  await assert.rejects(
    ops.applyDeployment(reviewed, p.profile, p.options),
    /AMBIGUOUS_RESOURCE_DISCOVERY/,
  );
  assert.equal(p.createCount, 1);
});
test('private native environment shape and secret-bearing snapshot fields are never accepted as technical state', async (t) => {
  const p = await fixture(t, 'dokploy');
  const reviewed = await plan(p);
  await ops.applyDeployment(reviewed, p.profile, p.options);
  const current = await ops.discoverDeployment(p.profile, p.options);
  const malicious = structuredClone(current);
  malicious.resources[0]!.settings.env = secret;
  assert.throws(
    () => ops.parseDeploymentSnapshot(malicious),
    /INVALID_SNAPSHOT_SETTINGS/,
  );
  p.apps[0]!.env = "PRIVATE_SECRET='ambiguous\nsecond-line'";
  await assert.rejects(
    ops.discoverDeployment(p.profile, p.options),
    /AMBIGUOUS_PRIVATE_ENVIRONMENT/,
  );
  assert.equal((await journalText(p)).includes(secret), false);
});

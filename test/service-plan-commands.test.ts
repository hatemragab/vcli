import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { describeServices } from '../dist/recipes/service-plan.js';
import { serviceFiles } from '../dist/recipes/render-services.js';
import {
  executeServiceCommand,
  planServiceCommand,
  assertServiceOwnership,
} from '../dist/services/service-commands.js';
import {
  executeDevCommand,
  assertDevPortAvailable,
} from '../dist/services/dev-command.js';
import { runOwnedProcess } from '../dist/services/owned-process.js';
import type {
  ServiceExecutionOptions,
  ServiceInvocation,
} from '../src/services/service-types.ts';

const config = {
  schemaVersion: 1 as const,
  project: { name: 'local-api', packageManager: 'npm' as const },
  capabilities: {
    foundation: { recipe: 'foundation.nest', options: {} },
    database: { recipe: 'database.mongodb', options: {} },
  },
};
const plan = describeServices(config, []);
async function fixture(t: test.TestContext): Promise<string> {
  const base = path.resolve('var/cli-operations');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'commands-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of serviceFiles(config, [])) {
    await mkdir(path.dirname(path.join(root, file.path)), { recursive: true });
    await writeFile(path.join(root, file.path), file.content);
  }
  return root;
}
const options = (root: string): ServiceExecutionOptions => ({
  root,
  plan,
  environment: {
    PRIVATE_SENTINEL: 'PRIVATE_SENTINEL',
    VCLI_CGROUP_PARENT: 'test.slice',
  },
});
function row(root: string, workingDir = root): string {
  return JSON.stringify([
    {
      Service: 'database',
      State: 'running',
      Labels: {
        'com.docker.compose.project': 'local-api-development',
        'com.docker.compose.project.working_dir': workingDir,
        'com.docker.compose.service': 'database',
        'io.vcli.project': 'local-api',
        'io.vcli.environment': 'development',
      },
    },
  ]);
}

test('dry service/dev plans do not inspect nonexistent roots or spawn and exclude secret input', async () => {
  const opts = {
    ...options(path.resolve('var/cli-operations/absent-root')),
    dryRun: true,
  };
  const runner = async () => {
    throw new Error('MUST_NOT_RUN');
  };
  const result = await executeServiceCommand('up', opts, runner);
  assert.equal(result.status, 'planned');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  assert.equal(
    (await executeDevCommand({ ...opts, port: 32001 }, runner)).status,
    'planned',
  );
  await assert.rejects(stat(opts.root), { code: 'ENOENT' });
});

test('up executes selected argument vectors, bounded setup/readiness and host cgroup seam', async (t) => {
  const root = await fixture(t),
    calls: ServiceInvocation[] = [];
  const result = await executeServiceCommand(
    'up',
    { ...options(root), databasePort: 32002 },
    async (invocation) => {
      calls.push(invocation);
      return { code: 0, stdout: calls.length === 1 ? row(root) : '' };
    },
  );
  assert.equal(result.status, 'completed');
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[1]!.args.slice(0, 2), ['volume', 'ls']);
  assert.ok(calls[2]!.args.includes('--wait'));
  assert.ok(calls[3]!.args.includes('database-init'));
  assert.ok(calls[4]!.args.includes('mongosh'));
  assert.equal(calls[0]!.environment.VCLI_DATABASE_PORT, '32002');
  assert.equal(calls[0]!.environment.VCLI_CGROUP_PARENT, 'test.slice');
  assert.equal(calls[0]!.environment.COMPOSE_DISABLE_ENV_FILE, '1');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
});

test('down preserves volume identity, checks ownership and never resets or rotates', async (t) => {
  const root = await fixture(t),
    calls: ServiceInvocation[] = [];
  await executeServiceCommand('down', options(root), async (invocation) => {
    calls.push(invocation);
    return { code: 0, stdout: calls.length === 1 ? row(root) : '' };
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.args.includes('down'));
  assert.equal(
    calls[1]!.args.some((arg) =>
      ['--volumes', '-v', '--rmi', '--remove-orphans'].includes(arg),
    ),
    false,
  );
  assert.match(
    await readFile(path.join(root, 'ops/local/compose.yaml'), 'utf8'),
    /local-api-development-database-data/,
  );
  assert.throws(
    () =>
      assertServiceOwnership(
        row(root, '/other-checkout'),
        options(root),
        'local-api-development',
      ),
    /SERVICE_OWNERSHIP_CONFLICT/,
  );
});

test('ownership conflict, edited artifacts, stale metadata and failed native commands refuse', async (t) => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(
    executeServiceCommand('down', options(root), async () => {
      calls++;
      return { code: 0, stdout: row(root, '/other') };
    }),
    /SERVICE_OWNERSHIP_CONFLICT/,
  );
  assert.equal(calls, 1);
  await writeFile(
    path.join(root, 'ops/local/development/compose.yaml'),
    '# customized\n',
  );
  await assert.rejects(
    executeServiceCommand('up', options(root), async () => {
      throw new Error('MUST_NOT_RUN');
    }),
    /LOCAL_SERVICE_ARTIFACT_CONFLICT/,
  );
  await writeFile(
    path.join(root, 'ops/local/development/service-plan.json'),
    '{}',
  );
  await assert.rejects(
    executeServiceCommand('up', options(root)),
    /STALE_LOCAL_SERVICE_PLAN/,
  );
  assert.throws(
    () => planServiceCommand('up', { ...options(root), databasePort: 70000 }),
    /INVALID_SERVICE_PORT/,
  );
});

test('only requested loopback port is probed and owned peer is always closed', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(
      assertDevPortAvailable(address.port),
      /DEV_PORT_UNAVAILABLE/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('native command/setup failures stop the vector sequence and release the operation lock', async (t) => {
  const root = await fixture(t);
  for (const failure of [1, 2, 3, 4, 5]) {
    let count = 0;
    await assert.rejects(
      executeServiceCommand('up', options(root), async () => {
        count++;
        return {
          code: count === failure ? 1 : 0,
          stdout: count === 1 ? row(root) : '',
        };
      }),
      /SERVICE_(?:INSPECTION|VOLUME_INSPECTION|COMMAND|SETUP_OR_READINESS)_FAILED/,
    );
    assert.equal(count, failure);
    await assert.rejects(
      stat(path.join(root, '.vcli/local/services-development.lock')),
      { code: 'ENOENT' },
    );
  }
});

test('status sanitizes output, checks ownership and executes only the read-only native vector', async (t) => {
  const root = await fixture(t);
  let count = 0;
  const result = await executeServiceCommand(
    'status',
    options(root),
    async (invocation) => {
      count++;
      assert.ok(invocation.args.includes('ps'));
      return { code: 0, stdout: row(root) };
    },
  );
  assert.equal(count, 1);
  assert.deepEqual(result.services, [
    { service: 'database', state: 'running' },
  ]);
  assert.equal(JSON.stringify(result).includes('Labels'), false);
  await assert.rejects(stat(path.join(root, '.vcli')), { code: 'ENOENT' });
});

test('up refuses an existing durable volume with foreign or unproven ownership', async (t) => {
  const root = await fixture(t);
  let called = 0;
  await assert.rejects(
    executeServiceCommand('up', options(root), async (invocation) => {
      called++;
      if (invocation.args[0] === 'volume')
        return {
          code: 0,
          stdout: JSON.stringify({
            Name: 'local-api-development-database-data',
            Labels: 'com.docker.compose.project=foreign-project',
          }),
        };
      return { code: 0, stdout: row(root) };
    }),
    /SERVICE_VOLUME_OWNERSHIP_CONFLICT/,
  );
  assert.equal(called, 2);
});

test('dev delegates local Nest with explicit environment, owns one lock and preserves replacement', async (t) => {
  const root = await fixture(t),
    nest = path.join(root, 'node_modules/@nestjs/cli/bin/nest.js');
  await mkdir(path.dirname(nest), { recursive: true });
  await writeFile(nest, '// test-owned fake; never executed\n');
  const envFile = path.join(root, 'private.env');
  await writeFile(envFile, 'PRIVATE_SENTINEL=PRIVATE_SENTINEL\n', {
    mode: 0o600,
  });
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  let called = 0;
  const result = await executeDevCommand(
    {
      root,
      plan,
      environment: { PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' },
      port,
      envFile,
    },
    async (invocation) => {
      called++;
      assert.deepEqual(invocation.args, [nest, 'start', '--watch']);
      assert.equal(invocation.environment.APP_ENV_FILE, envFile);
      assert.equal(invocation.environment.NODE_ENV, 'development');
      assert.equal(invocation.environment.HOST, '127.0.0.1');
      await assert.rejects(
        executeDevCommand({ root, plan, environment: {}, port }, async () => ({
          code: 0,
          stdout: '',
        })),
        /LOCAL_OPERATION_OWNERSHIP_CONFLICT/,
      );
      return { code: 0, stdout: '' };
    },
  );
  assert.equal(called, 1);
  assert.equal(result.code, 0);
  await assert.rejects(
    stat(path.join(root, '.vcli/local/dev-development.lock')),
    { code: 'ENOENT' },
  );
  await executeDevCommand({ root, plan, environment: {}, port }, async () => {
    const lock = path.join(root, '.vcli/local/dev-development.lock');
    await unlink(lock);
    await writeFile(lock, 'USER_REPLACEMENT', { mode: 0o600 });
    return { code: 0, stdout: '' };
  });
  assert.equal(
    await readFile(path.join(root, '.vcli/local/dev-development.lock'), 'utf8'),
    'USER_REPLACEMENT',
  );
});

test('dev refuses symlinked local state and unsafe private environment files', async (t) => {
  const root = await fixture(t),
    nest = path.join(root, 'node_modules/@nestjs/cli/bin/nest.js');
  await mkdir(path.dirname(nest), { recursive: true });
  await writeFile(nest, '');
  const envFile = path.join(root, 'private.env');
  await writeFile(envFile, 'PRIVATE_SENTINEL', { mode: 0o644 });
  await assert.rejects(
    executeDevCommand({ root, plan, environment: {}, port: 32003, envFile }),
    /UNSAFE_PRIVATE_ENV_FILE/,
  );
  await symlink(root, path.join(root, '.vcli'));
  await assert.rejects(
    executeDevCommand(
      { root, plan, environment: {}, port: 32003 },
      async () => ({ code: 0, stdout: '' }),
    ),
    /UNSAFE_LOCAL_STATE_DIRECTORY/,
  );
});

test('signals forward only to the launched group and listeners are released', async () => {
  const signals = new EventEmitter(),
    child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 654321,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const forwarded: { pid: number; signal: NodeJS.Signals }[] = [];
  const work = runOwnedProcess(
    {
      command: 'fixture',
      args: ['literal;$(no-shell)'],
      cwd: '.',
      environment: {},
    },
    {
      signals: signals as unknown as Pick<NodeJS.Process, 'on' | 'off'>,
      launch: () => child,
      signalGroup: (pid, signal) => {
        forwarded.push({ pid, signal });
      },
      capture: true,
    },
  );
  signals.emit('SIGINT');
  signals.emit('SIGTERM');
  child.stdout!.emit('data', Buffer.from('safe'));
  child.emit('close', 0, null);
  assert.deepEqual(await work, { code: 0, stdout: 'safe' });
  assert.deepEqual(forwarded, [
    { pid: 654321, signal: 'SIGINT' },
    { pid: 654321, signal: 'SIGTERM' },
  ]);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('delegated process start/output failures are bounded and sanitized', async () => {
  const invocation = {
    command: 'fixture',
    args: [],
    cwd: '.',
    environment: { PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' },
  };
  await assert.rejects(
    runOwnedProcess(invocation, {
      launch: () => {
        throw new Error('PRIVATE_SENTINEL');
      },
    }),
    /SERVICE_PROCESS_START_FAILED/,
  );
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    pid: 654322,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const signals = new EventEmitter();
  let terminated = 0;
  const work = runOwnedProcess(invocation, {
    signals: signals as unknown as Pick<NodeJS.Process, 'on' | 'off'>,
    launch: () => child,
    capture: true,
    signalGroup: () => {
      terminated++;
    },
  });
  child.stdout!.emit('data', Buffer.alloc(262145));
  child.emit('close', 1, null);
  await assert.rejects(work, /SERVICE_PROCESS_OUTPUT_LIMIT/);
  assert.equal(terminated, 1);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

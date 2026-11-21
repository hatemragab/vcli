import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repository = resolve('.'),
  workspace = await mkdtemp(join(tmpdir(), 'vcli-make-gate-'));
const project = join(workspace, 'api'),
  evidence = join(repository, 'var/cli-evidence/make-install');
await mkdir(evidence, { recursive: true, mode: 0o700 });
const records: { name: string; exitCode: number | null }[] = [];
const environment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C',
  NO_COLOR: '1',
  NPM_CONFIG_OFFLINE: 'true',
};
let child: ReturnType<typeof spawn> | undefined,
  success = false;
function run(name: string, command: string, args: string[], cwd = project) {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 1000000,
  });
  records.push({ name, exitCode: result.status });
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'MAKE_GATE_' + name.toUpperCase());
  return result.stdout;
}
try {
  const generated = JSON.parse(
    run(
      'generate',
      process.execPath,
      [
        join(repository, 'bin/vcli.mjs'),
        'init',
        project,
        '--name',
        'make-preview',
        '--yes',
        '--skip-install',
        '--json',
      ],
      workspace,
    ),
  );
  assert.equal(generated.status, 'pending');
  assert.equal(
    JSON.parse(await readFile(join(project, 'vcli.lock.json'), 'utf8')).outcomes
      .install,
    'pending',
  );
  run('source-only-make-install', 'make', ['install']);
  const installed = JSON.parse(
    run('inspect-installed', process.execPath, [
      'node_modules/@vcli/cli/bin/vcli.mjs',
      'inspect',
      '--json',
    ]),
  );
  assert.equal(installed.data.outcomes.install, 'completed');
  assert.deepEqual(installed.data.issues, []);
  await writeFile(
    join(project, 'count-install.mjs'),
    "import {appendFileSync} from 'node:fs';appendFileSync('.install-count','x');\n",
  );
  const manifest = JSON.parse(
    await readFile(join(project, 'package.json'), 'utf8'),
  );
  manifest.scripts.preinstall = 'node count-install.mjs';
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  run('make-install-root-lifecycle', 'make', ['install']);
  assert.equal(
    await readFile(join(project, '.install-count'), 'utf8'),
    'x',
    'bootstrap must not execute application lifecycle twice',
  );
  run('make-dev-preview', 'make', ['dev-plan']);
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, '127.0.0.1', resolve),
  );
  const address = listener.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  child = spawn('make', ['dev', 'PORT=' + port], {
    cwd: project,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (data: Buffer) => {
    output = (output + data.toString()).slice(-65536);
  });
  child.stderr?.on('data', (data: Buffer) => {
    output = (output + data.toString()).slice(-65536);
  });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null)
      throw new Error('MAKE_DEV_EXITED_BEFORE_READY');
    try {
      const response = await fetch(
        'http://127.0.0.1:' + port + '/health/ready',
        { signal: AbortSignal.timeout(300) },
      );
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* The owned watch compiler is still starting. */
    }
    await delay(250);
  }
  assert.ok(ready, 'SOURCE_ONLY_MAKE_INSTALL_THEN_MAKE_DEV_READY');
  records.push({ name: 'make-dev-health', exitCode: 0 });
  process.kill(-child.pid!, 'SIGTERM');
  for (
    let attempt = 0;
    attempt < 60 && child.exitCode === null && child.signalCode === null;
    attempt++
  )
    await delay(100);
  assert.ok(
    child.exitCode !== null || child.signalCode !== null,
    'MAKE_DEV_SIGNAL_CLEANUP',
  );
  let closed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch('http://127.0.0.1:' + port + '/health/live', {
        signal: AbortSignal.timeout(200),
      });
    } catch {
      closed = true;
      break;
    }
    await delay(100);
  }
  assert.ok(closed, 'OWNED_MAKE_DEV_LISTENER_CLOSED');
  records.push({ name: 'make-dev-signal-cleanup', exitCode: 0 });
  await writeFile(join(evidence, 'dev.log'), output, { mode: 0o600 });
  success = true;
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already stopped owned group. */
    }
  }
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(
      {
        status: success ? 'passed' : 'failed',
        records,
        workspace: success ? 'removed' : workspace,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  if (success) await rm(workspace, { recursive: true, force: true });
}
process.stdout.write(
  'Source-only make install, single root lifecycle and actual make dev/stop passed.\n',
);

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

async function runMain(t: TestContext, overrides: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV_FILE: '',
    NODE_ENV: 'test',
    ...overrides,
  };
  delete env.DATABASE_DRIVER;
  const child = spawn(process.execPath, ['dist/main.js'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  let output = '';
  const capture = (chunk: Buffer): void => {
    output += chunk.toString('utf8');
    assert.ok(output.length < 1048576, 'Startup output must remain bounded');
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const [code] = await once(child, 'close', {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(code, 1);
  return output;
}

test(
  'invalid configuration emits safe stdout without creating untrusted evidence',
  { timeout: 12000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'reference-startup-config-'),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const evidence = join(directory, 'evidence');
    const sentinel = 'private-startup-config-value';
    const output = await runMain(t, {
      PORT: sentinel,
      EVIDENCE_DIRECTORY: evidence,
    });
    assert.match(output, /application.start-failed/);
    assert.match(output, /INVALID_CONFIG/);
    assert.equal(output.includes(sentinel), false);
    await assert.rejects(lstat(evidence), { code: 'ENOENT' });
  },
);

test(
  'real early database failure is retained before cleanup and releases writer lock',
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'reference-startup-database-'),
    );
    const evidence = join(directory, 'evidence');
    // This task-owned TCP listener refuses the database protocol. No real database
    // or independently running service is queried by this failure-injection test.
    const rejecting = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      rejecting.listen(0, '127.0.0.1', resolve),
    );
    t.after(async () => {
      await new Promise<void>((resolve) => rejecting.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    });
    const address = rejecting.address();
    assert.ok(address && typeof address === 'object');
    const sentinel = 'private-startup-database-password';
    const output = await runMain(t, {
      PORT: '3100',
      DATABASE_URL: `postgresql://diagnostics:${sentinel}@127.0.0.1:${address.port}/reference`,
      AUTH_DRIVER: 'local',
      MAIL_DRIVER: 'capture',
      STORAGE_DRIVER: 'local',
      REALTIME_DRIVER: 'socketio',
      FCM_ENABLED: 'false',
      APNS_ENABLED: 'false',
      EVIDENCE_DIRECTORY: evidence,
      LOCAL_STORAGE_ROOT: join(directory, 'storage'),
    });
    const names = (await readdir(evidence)).filter((name) =>
      name.endsWith('.jsonl'),
    );
    assert.ok(names.length > 0);
    const retained = (
      await Promise.all(
        names.map((name) => readFile(join(evidence, name), 'utf8')),
      )
    ).join('');
    for (const content of [output, retained]) {
      assert.match(content, /application.starting/);
      assert.match(content, /application.start-failed/);
      assert.match(content, /application.stopped/);
      assert.equal(content.includes(sentinel), false);
      const events = content
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert.equal(
        events.filter((event) => event.event === 'application.start-failed')
          .length,
        1,
      );
    }
    await assert.rejects(lstat(join(evidence, 'writer.lock')), {
      code: 'ENOENT',
    });
  },
);

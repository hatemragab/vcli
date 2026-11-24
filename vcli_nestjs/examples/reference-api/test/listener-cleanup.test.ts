import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'occupied listener releases initialized database resources and the diagnostic writer lock',
  { timeout: 20000, skip: !databaseUrl },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), 'native-reference-listener-'),
    );
    const blocker = createServer();
    blocker.listen(0, '127.0.0.1');
    await once(blocker, 'listening');
    const address = blocker.address();
    assert.ok(address && typeof address === 'object');
    const evidence = join(directory, 'evidence');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_ENV_FILE: '',
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(address.port),
      DATABASE_URL: databaseUrl,
      AUTH_DRIVER: 'local',
      MAIL_DRIVER: 'capture',
      STORAGE_DRIVER: 'local',
      REALTIME_DRIVER: 'socketio',
      FCM_ENABLED: 'false',
      APNS_ENABLED: 'false',
      LOCAL_STORAGE_ROOT: join(directory, 'storage'),
      EVIDENCE_DIRECTORY: evidence,
    };
    delete env.DATABASE_DRIVER;
    const child = spawn(process.execPath, ['dist/main.js'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'close');
      }
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    });
    let output = '';
    const capture = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      assert.ok(output.length < 1048576, 'Startup output must remain bounded');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const [code] = await once(child, 'close', {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(code, 1);
    assert.match(output, /application.starting/);
    assert.match(output, /application.start-failed/);
    assert.match(output, /STARTUP_FAILED/);
    assert.match(output, /application.stopped/);
    const names = (await readdir(evidence)).filter((name) =>
      name.endsWith('.jsonl'),
    );
    const retained = (
      await Promise.all(
        names.map((name) => readFile(join(evidence, name), 'utf8')),
      )
    ).join('');
    assert.match(retained, /application.start-failed/);
    assert.match(retained, /application.stopped/);
    await assert.rejects(lstat(join(evidence, 'writer.lock')), {
      code: 'ENOENT',
    });
  },
);

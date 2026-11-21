import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Evidence: installed bin/vcli.mjs against the notes project's startup schema.
// This is not hosted-provider acceptance.
const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));
const probe = fileURLToPath(
  new URL('../bin/config-schema-probe.mjs', import.meta.url),
);
const workspace = fileURLToPath(new URL('..', import.meta.url));
const project = join(workspace, 'examples/test_notes_mongo');
const databaseUrl =
  'mongodb://127.0.0.1:27017/app?replicaSet=rs0&directConnection=true';

function run(
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string } {
  const child = spawnSync(executable, args, {
    cwd: workspace,
    encoding: 'utf8',
    env,
  });
  return { status: child.status, stdout: child.stdout };
}

test('installed config check accepts startup-valid local auth and names malformed fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-config-check-'));
  const key = randomBytes(32).toString('base64url');
  const env = { ...process.env };
  for (const name of [
    'DATABASE_URL',
    'JWT_KEYS_JSON',
    'JWT_ACTIVE_KID',
    'APP_ENV_FILE',
    'DATABASE_DRIVER',
  ])
    delete env[name];
  const validBody = [
    `DATABASE_URL=${databaseUrl}`,
    'JWT_ACTIVE_KID=current',
    `JWT_KEYS_JSON='${JSON.stringify([{ id: 'current', key }])}'`,
    '',
  ].join('\n');
  const valid = join(directory, 'valid.env');
  const badUrl = join(directory, 'bad-url.env');
  const badKey = join(directory, 'bad-key.env');
  await writeFile(valid, validBody, { mode: 0o600 });
  await writeFile(
    badUrl,
    validBody.replace(databaseUrl, 'http://127.0.0.1:27017/app'),
    { mode: 0o600 },
  );
  await writeFile(badKey, validBody.replace(key, 'not-a-key'), {
    mode: 0o600,
  });
  await chmod(valid, 0o600);
  await chmod(badUrl, 0o600);
  await chmod(badKey, 0o600);
  const hidden = [key, databaseUrl, 'http://127.0.0.1:27017/app', 'not-a-key'];
  try {
    const dry = run(
      [
        '--json',
        '--project',
        project,
        'config',
        'check',
        '--dry-run',
        '--config-file',
        join(directory, 'missing.env'),
      ],
      env,
    );
    assert.equal(dry.status, 0);
    const preview = JSON.parse(dry.stdout) as {
      data: { status: string; schema: string };
    };
    assert.equal(preview.data.status, 'not-run');
    assert.equal(preview.data.schema, 'selected-model');
    assert.equal(dry.stdout.includes(key), false);

    const accepted = run(
      [
        '--json',
        '--project',
        project,
        'config',
        'check',
        '--config-file',
        valid,
      ],
      env,
    );
    assert.equal(accepted.status, 0, accepted.stdout);
    const ok = JSON.parse(accepted.stdout) as {
      status: string;
      data: { status: string; schema: string; invalid: string[]; next: string };
    };
    assert.equal(ok.status, 'completed');
    assert.equal(ok.data.status, 'valid');
    assert.equal(ok.data.schema, 'startup');
    assert.deepEqual(ok.data.invalid, []);
    assert.match(ok.data.next, /^vcli release apply /);
    for (const secret of hidden)
      assert.equal(accepted.stdout.includes(secret), false);

    const urlFailure = run(
      [
        '--json',
        '--project',
        project,
        'config',
        'check',
        '--config-file',
        badUrl,
      ],
      env,
    );
    assert.equal(urlFailure.status, 1);
    const urlJson = JSON.parse(urlFailure.stdout) as {
      data: { status: string; invalid: string[]; code: string };
    };
    assert.equal(urlJson.data.status, 'invalid');
    assert.equal(urlJson.data.code, 'INVALID_CONFIG');
    assert.ok(urlJson.data.invalid.includes('DATABASE_URL'));
    for (const secret of hidden)
      assert.equal(urlFailure.stdout.includes(secret), false);

    const keyFailure = run(
      [
        '--json',
        '--project',
        project,
        'config',
        'check',
        '--config-file',
        badKey,
      ],
      env,
    );
    assert.equal(keyFailure.status, 1);
    const keyJson = JSON.parse(keyFailure.stdout) as {
      data: { status: string; invalid: string[] };
    };
    assert.equal(keyJson.data.status, 'invalid');
    assert.ok(keyJson.data.invalid.includes('JWT_KEYS_JSON'));
    for (const secret of hidden)
      assert.equal(keyFailure.stdout.includes(secret), false);

    const overridden = run(
      [
        '--json',
        '--project',
        project,
        'config',
        'check',
        '--config-file',
        valid,
      ],
      { ...env, DATABASE_URL: 'http://127.0.0.1/not-mongo' },
    );
    assert.equal(overridden.status, 1);
    const precedence = JSON.parse(overridden.stdout) as {
      data: { invalid: string[] };
    };
    assert.ok(precedence.data.invalid.includes('DATABASE_URL'));
    assert.equal(overridden.stdout.includes('not-mongo'), false);
    assert.equal(overridden.stdout.includes(key), false);

    const missing = spawnSync(process.execPath, [probe, directory, valid], {
      encoding: 'utf8',
    });
    const unavailable = JSON.parse(missing.stdout) as {
      status: string;
      code: string;
      reason: string;
    };
    assert.equal(unavailable.status, 'schema-unavailable');
    assert.equal(unavailable.code, 'CONFIG_SCHEMA_UNAVAILABLE');
    assert.equal(unavailable.reason, 'missing-startup-module');
    assert.equal(missing.stdout.includes(key), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

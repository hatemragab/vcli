import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));
interface PublicResult {
  schemaVersion: number;
  status: string;
  operation: string;
  errors?: { code: string; action: string }[];
  data?: {
    changes?: { path: string }[];
    changed?: string[];
    outcomes?: Record<string, string>;
    issues?: unknown[];
    privateFiles?: string[];
  };
}
function cli(cwd: string, args: string[], timeout = 20_000) {
  const child = spawnSync(process.execPath, [executable, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4_000_000,
    env: { ...process.env, PRIVATE_CONFIG_SENTINEL: 'SECRET_CLI_ENV_SENTINEL' },
  });
  assert.ifError(child.error);
  const lines = child.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'JSON mode emits exactly one result');
  const result: PublicResult = JSON.parse(lines[0]!);
  assert.equal(result.schemaVersion, 1);
  assert.doesNotMatch(child.stdout + child.stderr, /SECRET_CLI_ENV_SENTINEL/);
  return { code: child.status, result, stderr: child.stderr };
}
function git(cwd: string, ...args: string[]): string {
  const child = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim();
}
async function workspace(run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'vcli-command-'));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true });
  }
}
async function initialize(path: string) {
  const outcome = cli(path, [
    'init',
    'api',
    '--name',
    'test-api',
    '--yes',
    '--skip-install',
  ]);
  assert.equal(outcome.code, 0);
  assert.equal(outcome.result.status, 'pending');
  return join(path, 'api');
}

test('noninteractive missing input exits promptly without writes or private environment output', async () =>
  workspace(async (path) => {
    const outcome = cli(path, ['init']);
    assert.equal(outcome.code, 1);
    assert.equal(outcome.result.errors?.[0]?.code, 'MISSING_INPUT');
    assert.deepEqual(await readdir(path), []);
  }));
test('real CLI dry run creates no project and exposes paths rather than rendered source', async () =>
  workspace(async (path) => {
    const outcome = cli(path, [
      'init',
      'api',
      '--yes',
      '--skip-install',
      '--dry-run',
    ]);
    assert.equal(outcome.code, 0);
    assert.equal(outcome.result.status, 'preview');
    assert.ok((outcome.result.data?.changes?.length ?? 0) > 10);
    assert.deepEqual(outcome.result.data?.privateFiles, ['.env.development']);
    assert.doesNotMatch(
      JSON.stringify(outcome.result),
      /class HealthController|"content"/,
    );
    assert.deepEqual(await readdir(path), []);
  }));
test('full local API init previews name the capture default and respect explicit SMTP', async () =>
  workspace(async (path) => {
    const args = [
      executable,
      'init',
      'api',
      '--yes',
      '--preset',
      'api',
      '--database',
      'postgres',
      '--local-auth-profile',
      'full',
      '--dry-run',
    ];
    const preview = (options: string[]) => {
      const result = spawnSync(process.execPath, [...args, ...options], {
        cwd: path,
        encoding: 'utf8',
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const capture = preview([]);
    assert.match(capture, /features:.*mail\.capture/);
    assert.match(capture, /features:.*media\.private/);
    assert.match(capture, /features:.*example\.notes/);
    assert.match(capture, /features:.*realtime\.socket-io/);
    assert.match(capture, /Production startup rejects it/);
    assert.match(capture, /--mail smtp or --mail http/);
    const smtp = preview(['--with', 'mail.smtp']);
    assert.match(smtp, /features:.*mail\.smtp/);
    assert.doesNotMatch(smtp, /mail\.capture|Production startup rejects it/);
    assert.deepEqual(await readdir(path), []);
  }));
test('the API preset defaults to basic auth, storage and diagnostics', async () =>
  workspace(async (path) => {
    const options = [
      '--yes',
      '--preset',
      'api',
      '--with',
      'database.postgres',
      '--skip-install',
    ];
    for (const [directory, extra] of [
      ['api-default', []],
      ['api-with-recipe', ['--with', 'auth.local', '--with', 'storage.r2']],
    ] as const) {
      const outcome = cli(path, ['init', directory, ...options, ...extra]);
      assert.equal(outcome.code, 0, JSON.stringify(outcome.result.errors));
      const project = join(path, directory);
      const config = JSON.parse(
        await readFile(join(project, 'vcli.json'), 'utf8'),
      );
      assert.deepEqual(Object.keys(config.capabilities).sort(), [
        'auth',
        'database',
        'diagnostics',
        'foundation',
        'storage',
      ]);
      assert.deepEqual(config.capabilities.auth, {
        recipe: 'auth.local',
        options: { profile: 'basic' },
      });
      assert.equal(
        config.capabilities.storage.recipe,
        directory === 'api-default' ? 'storage.local' : 'storage.r2',
      );
      if (directory === 'api-default') {
        const storage = await stat(join(project, 'storage'));
        assert.ok(storage.isDirectory());
        assert.equal(storage.mode & 0o777, 0o700);
        assert.match(
          await readFile(join(project, '.gitignore'), 'utf8'),
          /^\/storage\/$/m,
        );
        assert.ok(
          /^LOCAL_STORAGE_ROOT=storage$/m.test(
            await readFile(join(project, '.env.development'), 'utf8'),
          ),
        );
      } else {
        assert.ok(!(await readdir(project)).includes('storage'));
      }
      const lock = JSON.parse(
        await readFile(join(project, 'vcli.lock.json'), 'utf8'),
      );
      assert.deepEqual(lock.config.capabilities.auth, config.capabilities.auth);

      const addNotes = cli(project, ['add', 'example.notes', '--dry-run']);
      assert.equal(addNotes.code, 1);
      assert.match(
        addNotes.result.errors?.[0]?.action ?? '',
        /requires full local auth or Firebase/,
      );
    }

    const firebase = cli(path, [
      'init',
      'firebase-api',
      ...options,
      '--with',
      'auth.firebase',
      '--dry-run',
    ]);
    assert.equal(firebase.code, 0, JSON.stringify(firebase.result.errors));
    const preview = JSON.stringify(firebase.result.data);
    assert.match(preview, /auth\.firebase/);
    assert.match(preview, /example\.notes/);
    assert.doesNotMatch(preview, /auth\.local/);
  }));
test('basic auth rejects full-only capabilities and invalid profiles before writes', async () =>
  workspace(async (path) => {
    const init = ['init', 'api', '--database', 'postgres', '--yes'];
    for (const options of [
      ['--media'],
      ['--notes', '--preset', 'api'],
      ['--realtime', 'socket-io'],
      ['--push', 'fcm'],
      ['--with', 'push.apns'],
    ]) {
      const outcome = cli(path, [...init, '--auth', 'local', ...options]);
      assert.equal(outcome.code, 1);
      const error = outcome.result.errors?.[0];
      assert.equal(error?.code, 'INVALID_OPTIONS');
      assert.match(error.action, /requires full local auth or Firebase/);
      assert.match(error.action, /--local-auth-profile full/);
    }
    const noAuth = cli(path, [...init, '--notes']);
    assert.equal(noAuth.code, 1);
    assert.equal(noAuth.result.errors?.[0]?.code, 'MISSING_CAPABILITY');
    assert.match(
      noAuth.result.errors?.[0]?.action ?? '',
      /requires full local auth or Firebase/,
    );
    const invalid = cli(path, [
      ...init,
      '--auth',
      'local',
      '--local-auth-profile',
      'other',
    ]);
    assert.equal(invalid.code, 1);
    assert.match(
      invalid.result.errors?.[0]?.action ?? '',
      /Choose basic or full/,
    );
    const firebase = cli(path, [
      ...init,
      '--auth',
      'firebase',
      '--local-auth-profile',
      'basic',
    ]);
    assert.equal(firebase.code, 1);
    assert.match(
      firebase.result.errors?.[0]?.action ?? '',
      /Select auth\.local/,
    );
    assert.deepEqual(await readdir(path), []);
  }));
test('basic auth accepts explicitly selected standalone application mail', async () =>
  workspace(async (path) => {
    for (const provider of ['smtp', 'http', 'capture']) {
      const outcome = cli(path, [
        'init',
        'api',
        '--database',
        'postgres',
        '--auth',
        'local',
        '--mail',
        provider,
        '--yes',
        '--dry-run',
      ]);
      assert.equal(outcome.code, 0, JSON.stringify(outcome.result.errors));
      const paths = outcome.result.data?.changes?.map((change) => change.path);
      assert.ok(paths);
      assert.ok(paths.includes(`src/modules/mail/${provider}-mail.service.ts`));
      assert.ok(paths.includes('src/modules/auth/auth.service.ts'));
      assert.ok(!paths.includes('src/core/mail/action-delivery.ts'));
    }
    assert.deepEqual(await readdir(path), []);
  }));
test('init emits a standalone Redis Compose file only when explicitly requested for auth', async () =>
  workspace(async (path) => {
    const composePath = 'ops/compose.redis.development.yml';
    const init = ['init', 'api', '--yes', '--skip-install'];
    const noAuth = cli(path, [...init, '--redis-docker']);
    assert.equal(noAuth.code, 1);
    assert.equal(noAuth.result.errors?.[0]?.code, 'INVALID_OPTIONS');

    const auth = [
      ...init,
      '--database',
      'mongodb',
      '--auth',
      'local',
      '--local-identifier',
      'username',
    ];
    const defaultPreview = cli(path, [...auth, '--dry-run']);
    const optionalPreview = cli(path, [...auth, '--redis-docker', '--dry-run']);
    assert.equal(
      defaultPreview.code,
      0,
      JSON.stringify(defaultPreview.result.errors),
    );
    assert.equal(
      optionalPreview.code,
      0,
      JSON.stringify(optionalPreview.result.errors),
    );
    assert.equal(
      JSON.stringify(defaultPreview.result).includes(composePath),
      false,
    );
    assert.equal(
      JSON.stringify(optionalPreview.result).includes(composePath),
      true,
    );
    assert.deepEqual(await readdir(path), []);

    const applied = cli(path, [...auth, '--redis-docker']);
    assert.equal(applied.code, 0, JSON.stringify(applied.result.errors));
    assert.ok((await stat(join(path, 'api', composePath))).isFile());
    const config = JSON.parse(
      await readFile(join(path, 'api', 'vcli.json'), 'utf8'),
    );
    assert.deepEqual(config.capabilities.auth.options, {
      identifier: 'username',
      profile: 'basic',
      redisDocker: true,
    });
  }));
test('underscore project names survive generation with safe distinct service resource names', async () =>
  workspace(async (path) => {
    const name = 'test_notes_mongo';
    const outcome = cli(path, [
      'init',
      name,
      '--yes',
      '--database',
      'mongodb',
      '--storage',
      'local',
      '--diagnostics',
      '--skip-install',
    ]);
    assert.equal(outcome.code, 0);
    const project = join(path, name);
    for (const filename of ['vcli.json', 'vcli.lock.json', 'package.json']) {
      const data = JSON.parse(await readFile(join(project, filename), 'utf8'));
      assert.equal(
        filename === 'package.json'
          ? data.name
          : (data.config ?? data).project.name,
        name,
      );
    }
    const plan = JSON.parse(
      await readFile(
        join(project, 'ops/local/development/service-plan.json'),
        'utf8',
      ),
    );
    assert.equal(plan.project, name);
    for (const item of [...plan.services, ...plan.volumes]) {
      assert.match(item.resourceRef, /^[a-z][a-z0-9-]{0,62}$/);
    }
    const database = plan.services.find(
      (item: { id: string }) => item.id === 'database',
    );
    assert.match(database.image, /^mongo:/);
    assert.doesNotMatch(database.resourceRef, /_/);
  }));
test('minimal preset initializes an empty directory with the foundation alone', async () =>
  workspace(async (path) => {
    const outcome = cli(path, [
      'init',
      '.',
      '--name',
      'current-api',
      '--preset',
      'minimal',
      '--yes',
      '--skip-install',
    ]);
    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.result.data?.outcomes, {
      source: 'completed',
      install: 'pending',
      checks: 'pending',
    });
    const config = JSON.parse(await readFile(join(path, 'vcli.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.capabilities), ['foundation']);
    const manifest = JSON.parse(
      await readFile(join(path, 'package.json'), 'utf8'),
    );
    for (const name of [
      'mongoose',
      'pg',
      'drizzle-orm',
      'firebase-admin',
      'argon2',
      'jose',
      '@redis/client',
      '@aws-sdk/client-s3',
      'nodemailer',
    ])
      assert.equal(manifest.dependencies[name], undefined);
    assert.equal(manifest.devDependencies['@vcli/cli'], 'file:tools/vcli');
    assert.ok((await stat(join(path, 'tools/vcli/bin/vcli.mjs'))).isFile());
    const minimalEnv = await readFile(join(path, '.env.development'), 'utf8');
    assert.doesNotMatch(
      minimalEnv,
      /^(?:REDIS_URL|JWT_KEYS_JSON|MAIL_DELIVERY_KEYS_JSON|CENTRIFUGO_API_KEY|CENTRIFUGO_PROXY_SECRET)=/m,
    );
    const inspection = cli(path, ['inspect']);
    assert.equal(inspection.code, 0);
    assert.equal(inspection.result.data?.outcomes?.install, 'pending');
    const diagnosis = cli(path, ['doctor']);
    assert.equal(diagnosis.code, 1);
    assert.ok((diagnosis.result.data?.issues?.length ?? 0) > 0);
  }));
test('a normally committed generated project keeps its pinned CLI, auth runtime, and Claude import', async () =>
  workspace(async (path) => {
    assert.equal(
      cli(path, [
        'init',
        'api',
        '--database',
        'postgres',
        '--auth',
        'local',
        '--local-auth-profile',
        'full',
        '--local-identifier',
        'username',
        '--yes',
        '--skip-install',
      ]).code,
      0,
    );
    const project = join(path, 'api');
    const config = JSON.parse(
      await readFile(join(project, 'vcli.json'), 'utf8'),
    );
    assert.deepEqual(config.capabilities.auth.options, {
      identifier: 'username',
    });
    await mkdir(join(project, 'dist'));
    await writeFile(join(project, 'dist/main.js'), '// local build');
    git(project, 'init', '-q');
    git(project, 'add', '-A');
    const tracked = git(project, 'ls-files').split('\n');
    assert.ok(tracked.includes('tools/vcli/dist/cli.js'));
    assert.ok(
      tracked.includes(
        'tools/vcli/runtime-packages/auth-runtime/dist/index.js',
      ),
    );
    assert.ok(tracked.includes('tools/vcli-auth-runtime/dist/index.js'));
    assert.ok(!tracked.includes('dist/main.js'));
    assert.equal(
      await readFile(join(project, 'CLAUDE.md'), 'utf8'),
      '@AGENTS.md\n',
    );
  }));
test('existing sentinels, symlink destinations and unsafe identifiers survive rejected init', async () =>
  workspace(async (path) => {
    await mkdir(join(path, 'api'));
    await writeFile(join(path, 'api/sentinel.txt'), 'preserve me');
    const nonempty = cli(path, ['init', 'api', '--yes', '--skip-install']);
    assert.equal(nonempty.code, 1);
    assert.equal(
      await readFile(join(path, 'api/sentinel.txt'), 'utf8'),
      'preserve me',
    );
    await mkdir(join(path, 'outside'));
    await symlink(join(path, 'outside'), join(path, 'link'));
    assert.equal(
      cli(path, ['init', 'link', '--yes', '--skip-install']).code,
      1,
    );
    assert.deepEqual(await readdir(join(path, 'outside')), []);
    assert.equal(
      cli(path, [
        'init',
        'new-api',
        '--name',
        'bad;touch marker',
        '--yes',
        '--skip-install',
      ]).code,
      1,
    );
    assert.equal((await readdir(path)).includes('marker'), false);
  }));
test('exclusive database and missing required capability selections fail before writes', async () =>
  workspace(async (path) => {
    const missing = cli(path, [
      'init',
      'api',
      '--auth',
      'local',
      '--yes',
      '--skip-install',
    ]);
    assert.equal(missing.code, 1);
    assert.equal(missing.result.errors?.[0]?.code, 'MISSING_CAPABILITY');
    const both = cli(path, [
      'init',
      'api',
      '--database',
      'mongodb',
      '--with',
      'database.postgres',
      '--yes',
      '--skip-install',
    ]);
    assert.equal(both.code, 1);
    assert.equal(both.result.errors?.[0]?.code, 'RECIPE_CONFLICT');
    assert.deepEqual(await readdir(path), []);
  }));
test('add capture preserves custom source, private config, package fields and guidance; repeat is idempotent', async () =>
  workspace(async (path) => {
    const project = await initialize(path);
    const customPath = join(project, 'src/app.custom.module.ts');
    const custom =
      (await readFile(customPath, 'utf8')) +
      '\n// developer business integration sentinel\n';
    await writeFile(customPath, custom);
    const readmePath = join(project, 'README.md');
    await writeFile(
      readmePath,
      (await readFile(readmePath, 'utf8')) +
        '\nDeveloper-owned notes survive.\n',
    );
    await writeFile(
      join(project, '.env.development'),
      'PRIVATE_KEY=SECRET_PRIVATE_FILE_SENTINEL\n',
    );
    const manifestPath = join(project, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const lockPath = join(project, 'vcli.lock.json');
    const legacyLock = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(legacyLock.packageFields['/version'], undefined);
    legacyLock.packageFields['/version'] = manifest.version;
    await writeFile(lockPath, JSON.stringify(legacyLock, null, 2) + '\n');
    manifest.version = '0.2.0';
    manifest.scripts['custom:check'] = 'node -e "process.exit(0)"';
    manifest.customMetadata = { owner: 'developer' };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const added = cli(project, ['add', 'mail.capture', '--skip-install']);
    assert.equal(added.code, 0);
    assert.equal(await readFile(customPath, 'utf8'), custom);
    assert.match(
      await readFile(readmePath, 'utf8'),
      /Developer-owned notes survive/,
    );
    const after = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(after.version, '0.2.0');
    const lockAfter = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(lockAfter.packageFields['/version'], undefined);
    assert.equal(
      after.scripts['custom:check'],
      manifest.scripts['custom:check'],
    );
    assert.deepEqual(after.customMetadata, manifest.customMetadata);
    assert.equal(
      await readFile(join(project, '.env.development'), 'utf8'),
      'PRIVATE_KEY=SECRET_PRIVATE_FILE_SENTINEL\n',
    );
    const repeated = cli(project, ['add', 'mail.capture', '--skip-install']);
    assert.equal(repeated.code, 0);
    assert.deepEqual(repeated.result.data?.changed, []);
    const feature = cli(project, [
      'g',
      'feature',
      'receipts',
      '--use',
      'mail',
      '--skip-install',
    ]);
    assert.equal(feature.code, 0);
    assert.match(
      await readFile(
        join(project, 'src/modules/receipts/receipts.service.ts'),
        'utf8',
      ),
      /@Inject\(MailService\)/,
    );
    assert.match(
      await readFile(
        join(project, 'src/modules/receipts/receipts.module.ts'),
        'utf8',
      ),
      /imports: \[MailModule\]/,
    );
    const realized = JSON.parse(
      await readFile(join(project, 'vcli.lock.json'), 'utf8'),
    );
    assert.deepEqual(
      realized.checks.map((check: { name: string }) => check.name),
      ['architecture', 'database', 'lint', 'typecheck'],
    );
  }));
test('explicit saved plan is private and apply refuses a destination changed since preview', async () =>
  workspace(async (path) => {
    const planned = cli(path, [
      'init',
      'api',
      '--yes',
      '--skip-install',
      '--save-plan',
      join(path, 'saved-plan.json'),
    ]);
    assert.equal(planned.code, 0, JSON.stringify(planned.result.errors));
    assert.equal(planned.result.status, 'preview');
    assert.equal(
      (await stat(join(path, 'saved-plan.json'))).mode & 0o777,
      0o600,
    );
    await mkdir(join(path, 'api'));
    await writeFile(join(path, 'api/new-user-file.txt'), 'new edit');
    const applied = cli(path, [
      'apply',
      join(path, 'saved-plan.json'),
      '--skip-install',
    ]);
    assert.equal(applied.code, 1);
    assert.equal(
      await readFile(join(path, 'api/new-user-file.txt'), 'utf8'),
      'new edit',
    );
    assert.deepEqual(await readdir(join(path, 'api')), ['new-user-file.txt']);
  }));
test('direct and saved-plan init create distinct private development keys', async () =>
  workspace(async (path) => {
    const flags = [
      '--yes',
      '--database',
      'mongodb',
      '--auth',
      'local',
      '--local-auth-profile',
      'full',
      '--local-identifier',
      'username',
      '--mail',
      'capture',
      '--reliable-actions',
      '--realtime',
      'centrifugo',
      '--skip-install',
    ];
    const saved = join(path, 'saved-plan.json');
    const privateFile = '.env.development';
    const preview = cli(path, [
      'init',
      'planned',
      ...flags,
      '--save-plan',
      saved,
    ]);
    assert.equal(preview.code, 0, JSON.stringify(preview.result.errors));
    assert.deepEqual(await readdir(path), ['saved-plan.json']);
    const serialized = await readFile(saved, 'utf8');
    const plan = JSON.parse(serialized) as {
      changes: { path: string }[];
      developmentDefaults: Record<string, string>;
    };
    assert.ok(plan.changes.every((change) => change.path !== privateFile));
    const privateFields = [
      'JWT_KEYS_JSON',
      'MAIL_DELIVERY_KEYS_JSON',
      'CENTRIFUGO_API_KEY',
      'CENTRIFUGO_PROXY_SECRET',
    ];
    for (const field of privateFields)
      assert.equal(Object.hasOwn(plan.developmentDefaults, field), false);
    const forged = join(path, 'forged-plan.json');
    for (const field of ['CENTRIFUGO_API_KEY', 'CENTRIFUGO_PROXY_SECRET']) {
      await writeFile(
        forged,
        JSON.stringify({
          ...plan,
          developmentDefaults: {
            ...plan.developmentDefaults,
            [field]: 'FORGED_PRIVATE_VALUE',
          },
        }),
        { mode: 0o600 },
      );
      const refused = cli(path, ['apply', forged, '--skip-install']);
      assert.equal(refused.result.errors?.[0]?.code, 'INVALID_PLAN');
      await assert.rejects(stat(join(path, 'planned')), { code: 'ENOENT' });
    }

    const direct = cli(path, ['init', 'direct', ...flags], 60_000);
    const applied = cli(path, ['apply', saved, '--skip-install'], 60_000);
    const keys: string[] = [];
    for (const [projectName, outcome] of [
      ['direct', direct],
      ['planned', applied],
    ] as const) {
      assert.equal(outcome.code, 0, outcome.stderr);
      assert.ok(outcome.result.data?.changed?.includes(privateFile));
      const project = join(path, projectName);
      const file = join(project, privateFile);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      const body = await readFile(file, 'utf8');
      assert.ok(/^REDIS_URL=redis:\/\/127\.0\.0\.1:6379$/m.test(body));
      const active = /^JWT_ACTIVE_KID=(.+)$/m.exec(body)?.[1];
      const keySet = /^JWT_KEYS_JSON='(.+)'$/m.exec(body)?.[1];
      assert.ok(keySet && active);
      const [jwt] = JSON.parse(keySet) as { id: string; key: string }[];
      assert.ok(
        jwt &&
          jwt.id === active &&
          Buffer.from(jwt.key, 'base64url').length === 32,
      );
      const mailId = /^MAIL_DELIVERY_KEY_ID=(.+)$/m.exec(body)?.[1];
      const mailSet = /^MAIL_DELIVERY_KEYS_JSON='(.+)'$/m.exec(body)?.[1];
      const apiKey = /^CENTRIFUGO_API_KEY=(.+)$/m.exec(body)?.[1];
      const proxySecret = /^CENTRIFUGO_PROXY_SECRET=(.+)$/m.exec(body)?.[1];
      assert.ok(mailSet && mailId && apiKey && proxySecret);
      const mailKey = (JSON.parse(mailSet) as Record<string, string>)[mailId];
      assert.ok(
        mailKey &&
          Buffer.from(mailKey, 'base64').length === 32 &&
          Buffer.from(apiKey, 'base64url').length === 32 &&
          Buffer.from(proxySecret, 'base64url').length === 32,
      );
      const projectKeys = [jwt.key, mailKey, apiKey, proxySecret];
      keys.push(...projectKeys);

      const lock = await readFile(join(project, 'vcli.lock.json'), 'utf8');
      const inventory = JSON.parse(lock) as {
        files: Record<string, unknown>;
        operationId: string;
      };
      assert.equal(Object.hasOwn(inventory.files, privateFile), false);
      const journal = await readFile(
        join(
          project,
          '.vcli/local/operations',
          `${inventory.operationId}.json`,
        ),
        'utf8',
      );
      assert.equal(
        [
          serialized,
          lock,
          journal,
          JSON.stringify(outcome.result),
          outcome.stderr,
        ].some((text) => projectKeys.some((key) => text.includes(key))),
        false,
      );
      assert.equal(
        (await readdir(project)).some((name) =>
          /^\.env\..*\.example$/.test(name),
        ),
        false,
      );
      git(project, 'init', '-q');
      assert.equal(git(project, 'check-ignore', privateFile), privateFile);
    }
    assert.equal(new Set(keys).size, 8);
  }));

test('name-only controller stays unexposed and unsupported upgrade target is refused', async () =>
  workspace(async (path) => {
    const project = await initialize(path);
    const custom = await readFile(
      join(project, 'src/app.custom.module.ts'),
      'utf8',
    );
    const generated = cli(project, [
      'g',
      'controller',
      'widgets',
      '--skip-install',
    ]);
    assert.equal(generated.code, 0);
    const source = await readFile(
      join(project, 'src/modules/widgets/widgets.controller.ts'),
      'utf8',
    );
    assert.doesNotMatch(source, /@(Get|Post|Put|Delete|Patch)\(/);
    assert.equal(
      await readFile(join(project, 'src/app.custom.module.ts'), 'utf8'),
      custom,
    );
    const unsupported = cli(project, [
      'upgrade',
      '--to',
      '999.0.0',
      '--skip-install',
    ]);
    assert.equal(unsupported.code, 1);
    assert.equal(unsupported.result.errors?.[0]?.code, 'UNSUPPORTED_RELEASE');
  }));

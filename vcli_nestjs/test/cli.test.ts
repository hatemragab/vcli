import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
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
    changes?: unknown[];
    changed?: string[];
    outcomes?: Record<string, string>;
    issues?: unknown[];
  };
}
function cli(cwd: string, args: string[]) {
  const child = spawnSync(process.execPath, [executable, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 20_000,
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
  const path = await mkdtemp(join(tmpdir(), 'vcli-command-'));
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
    assert.doesNotMatch(
      JSON.stringify(outcome.result),
      /class HealthController|"content"/,
    );
    assert.deepEqual(await readdir(path), []);
  }));
test('API init previews name the capture-only default and respect an explicit mail choice', async () =>
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
    assert.match(capture, /Production startup rejects it/);
    assert.match(capture, /--mail smtp or --mail http/);
    const smtp = preview(['--with', 'mail.smtp']);
    assert.match(smtp, /features:.*mail\.smtp/);
    assert.doesNotMatch(smtp, /mail\.capture|Production startup rejects it/);
    assert.deepEqual(await readdir(path), []);
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
test('init current empty directory records source-only state and no application provider dependencies', async () =>
  workspace(async (path) => {
    const outcome = cli(path, [
      'init',
      '.',
      '--name',
      'current-api',
      '--yes',
      '--skip-install',
    ]);
    assert.equal(outcome.code, 0);
    assert.deepEqual(outcome.result.data?.outcomes, {
      source: 'completed',
      install: 'pending',
      checks: 'pending',
    });
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
      '@aws-sdk/client-s3',
      'nodemailer',
    ])
      assert.equal(manifest.dependencies[name], undefined);
    assert.equal(manifest.devDependencies['@vcli/cli'], 'file:tools/vcli');
    assert.ok((await stat(join(path, 'tools/vcli/bin/vcli.mjs'))).isFile());
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
        '--local-identifier',
        'username',
        '--yes',
        '--skip-install',
      ]).code,
      0,
    );
    const project = join(path, 'api');
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
      '--mail',
      'capture',
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
      /imports: \[capabilities.mail\]/,
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
    assert.equal(planned.code, 0);
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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import type { ProjectConfig, RenderedFile } from '../src/contracts.js';
import { linkGeneratedDependencies } from './generated-dependencies.ts';

const root = resolve('var/cli-username-rendering');
let source:
  | Promise<{
      catalog: typeof import('../src/recipes/index.js');
      engine: typeof import('../src/engine/index.js');
      selection: typeof import('../src/commands/selection-options.js');
    }>
  | undefined;
function currentSource(): NonNullable<typeof source> {
  return (source ??= (async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      noUncheckedIndexedAccess: true,
      rootDir: resolve('src'),
      outDir: join(root, 'generator'),
      types: ['node'],
    };
    const program = ts.createProgram([resolve('src/cli.ts')], options);
    assertDiagnostics(program);
    program.emit();
    try {
      await symlink(resolve('templates'), join(root, 'templates'), 'dir');
    } catch (error: unknown) {
      if (!isExisting(error)) throw error;
    }
    return {
      catalog: await import(
        pathToFileURL(join(root, 'generator/recipes/index.js')).href
      ),
      engine: await import(
        pathToFileURL(join(root, 'generator/engine/index.js')).href
      ),
      selection: await import(
        pathToFileURL(join(root, 'generator/commands/selection-options.js'))
          .href
      ),
    };
  })());
}
function isExisting(error: unknown) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}
function selected(database: 'mongodb' | 'postgres'): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'test_notes_' + database, packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: 'database.' + database, options: {} },
      auth: { recipe: 'auth.local', options: { identifier: 'username' } },
      storage: { recipe: 'storage.local', options: {} },
      media: { recipe: 'media.private', options: {} },
      notes: { recipe: 'example.notes', options: {} },
      diagnostics: {
        recipe: 'diagnostics.local',
        options: { sources: ['application', 'database', 'infrastructure'] },
      },
    },
  };
}
function contents(files: readonly RenderedFile[], path: string) {
  const file = files.find((entry) => entry.path === path);
  assert.ok(file, path);
  return file.content;
}
function assertDiagnostics(program: ts.Program) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
}
async function render(config: ProjectConfig) {
  const { catalog, engine } = await currentSource();
  const resolved = engine.resolveRecipes(config, catalog.recipeCatalog);
  return catalog.recipeCatalog.render(resolved.config, resolved.recipes);
}

for (const database of ['mongodb', 'postgres'] as const) {
  test(`username/no-mail ${database} emits selected notes/storage/logging source with noEmit/lint/acyclic checks`, async () => {
    const project = await render(selected(database));
    assert.equal(
      project.files.some((file) =>
        /src\/(?:core|modules)\/mail\//.test(file.path),
      ),
      false,
    );
    assert.equal(
      project.files.some((file) =>
        /action-tokens|local-credentials|local-identity|provider-cleanup/.test(
          file.path,
        ),
      ),
      false,
    );
    const identity = contents(
      project.files,
      'src/modules/identity/identity.module.ts',
    );
    assert.match(identity, /UsernameCredentials/);
    assert.doesNotMatch(
      identity,
      /MailSubmitter|ActionDeliveryWriter|ActionTokens/,
    );
    for (const path of [
      'src/modules/identity/identity.service.ts',
      'src/modules/identity/identity.entity.ts',
      'src/initialize-identity-database.ts',
      ...(database === 'mongodb'
        ? ['src/modules/identity/identity-lifecycle-migration.ts']
        : [
            'migrations/001-identity.sql',
            'migrations/002-identity-lifecycle.sql',
          ]),
    ]) {
      assert.doesNotMatch(
        contents(project.files, path),
        /AppAction|['"]actions['"]|CREATE TABLE IF NOT EXISTS actions\b|addAction|consumeAction|AppProviderCleanup|\bprovider_cleanup\b|vcli:(?:begin|end)/,
        path,
      );
    }
    assert.match(
      contents(project.files, 'src/create-app.ts'),
      /createIdentityRuntime\(config, db\)/,
    );
    assert.doesNotMatch(
      contents(project.files, 'src/create-app.ts'),
      /mailRuntime|realtime/,
    );
    assert.doesNotMatch(
      contents(project.files, 'src/core/config/load-config.ts'),
      /MAIL_FROM|MAIL_CAPTURE|MAIL_DELIVERY|SMTP_|RESEND_/,
    );
    assert.match(
      contents(project.files, 'src/core/config/load-config.ts'),
      /identifier: 'username'/,
    );
    assert.doesNotMatch(
      contents(project.files, 'src/modules/identity/identity-inputs.ts'),
      /emailInput|verificationInput|resetInput|firebaseInput/,
    );
    assert.doesNotMatch(
      contents(
        project.files,
        'src/modules/identity/identity-request-bodies.ts',
      ),
      /verificationRequest|resetRequest|verificationConfirm|resetConfirm/,
    );
    assert.doesNotMatch(
      contents(project.files, 'clients/auth-local.mjs'),
      /requestAction|confirmAction/,
    );
    const manifest = JSON.parse(contents(project.files, 'package.json'));
    for (const dependency of [
      'nodemailer',
      'firebase-admin',
      'firebase',
      'socket.io',
      'ws',
      database === 'mongodb' ? 'pg' : 'mongoose',
    ])
      assert.equal(manifest.dependencies[dependency], undefined);
    assert.ok(manifest.dependencies.pino);
    assert.ok(manifest.dependencies.argon2);
    assert.ok(manifest.dependencies.jose);
    const directory = join(root, database);
    await rm(join(directory, 'src'), { recursive: true, force: true });
    for (const file of project.files) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    await linkGeneratedDependencies(directory);
    const configPath = join(directory, 'tsconfig.json');
    const parsed = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(parsed.error, undefined);
    const config = ts.parseJsonConfigFileContent(
      parsed.config,
      ts.sys,
      directory,
      { noEmit: true },
      configPath,
    );
    assertDiagnostics(ts.createProgram(config.fileNames, config.options));
    const architecture: {
      checkArchitecture(root: string): Promise<{ failures: readonly string[] }>;
    } = await import(
      pathToFileURL(join(directory, 'scripts/architecture-rules.ts')).href
    );
    assert.deepEqual(
      (await architecture.checkArchitecture(join(directory, 'src'))).failures,
      [],
    );
    const lint = spawnSync(
      process.execPath,
      [resolve('node_modules/eslint/bin/eslint.js'), 'src'],
      { cwd: directory, encoding: 'utf8', timeout: 30_000 },
    );
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
    assert.match(
      contents(project.files, 'README.md'),
      /recovery is unavailable/,
    );
  });
}

test('email auth retains canonical defaults and its explicit mail requirement', async () => {
  const { catalog, selection } = await currentSource();
  const local = catalog.recipeCatalog.recipes.find(
    (recipe) => recipe.id === 'auth.local',
  )!;
  assert.deepEqual(local.validateOptions({}), {});
  assert.deepEqual(local.validateOptions({ identifier: 'email' }), {});
  assert.deepEqual(local.validateOptions({ profile: 'full' }), {});
  assert.deepEqual(
    local.validateOptions({ profile: 'basic', identifier: 'username' }),
    {
      profile: 'basic',
      identifier: 'username',
    },
  );
  assert.throws(() => local.validateOptions({ identifier: 'unsupported' }));
  const email = selected('mongodb');
  email.capabilities.auth!.options = {};
  await assert.rejects(render(email), /MISSING_CAPABILITY:mail/);
  email.capabilities.mail = { recipe: 'mail.capture', options: {} };
  const project = await render(email);
  assert.match(
    contents(project.files, 'src/modules/identity/identity.module.ts'),
    /LocalCredentials|ActionTokens|MailSubmitter/,
  );
  assert.match(
    contents(project.files, 'clients/auth-local.mjs'),
    /requestAction/,
  );
  assert.match(
    contents(project.files, 'src/initialize-identity-database.ts'),
    /AppAction/,
  );
  const username = await render(selected('mongodb'));
  const manifest = 'src/generated/selected-release.ts';
  assert.notEqual(
    contents(project.files, manifest),
    contents(username.files, manifest),
  );
  assert.deepEqual(
    selection.selectRecipes(catalog.recipeCatalog, {
      auth: 'local',
      localIdentifier: 'username',
    }).auth,
    { recipe: 'auth.local', options: { identifier: 'username' } },
  );
  assert.throws(() =>
    selection.selectRecipes(catalog.recipeCatalog, {
      auth: 'firebase',
      localIdentifier: 'username',
    }),
  );
});

test('ordinary add refuses username/email identity conversion before writing', async () => {
  const { catalog, engine } = await currentSource();
  const directory = join(root, 'conversion-refusal');
  await rm(directory, { recursive: true, force: true });
  const config = selected('mongodb');
  const init = await engine.planInit({
    workspaceDir: root,
    projectDir: directory,
    config,
    catalog: catalog.recipeCatalog,
  });
  await engine.applyPlan(init);
  const before = await readFile(join(directory, 'vcli.json'), 'utf8');
  await assert.rejects(
    engine.planAdd({
      projectDir: directory,
      selections: {
        auth: { recipe: 'auth.local', options: {} },
        mail: { recipe: 'mail.capture', options: {} },
      },
      catalog: catalog.recipeCatalog,
    }),
    (error: unknown) =>
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'STATE_DRIFT',
  );
  assert.equal(await readFile(join(directory, 'vcli.json'), 'utf8'), before);
});

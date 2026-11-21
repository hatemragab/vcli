import { TOOL_VERSION } from '../dist/contracts.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ProjectConfig,
  RecipeCatalog,
  RenderedFile,
} from '../src/contracts.ts';
import {
  maintenanceFixture,
  maintenanceModule,
  prepareMaintenanceFixture,
} from './maintenance-fixture.ts';

before(prepareMaintenanceFixture);
type Engine = typeof import('../src/engine/index.ts');
type Maintenance = typeof import('../src/maintenance/index.ts');
type Migrations = typeof import('../src/engine/source-migrations.ts');
const engine = () => maintenanceModule<Engine>('engine/index');
const maintenance = () => maintenanceModule<Maintenance>('maintenance/index');
const migrations = () =>
  maintenanceModule<Migrations>('engine/source-migrations');
const config = (): ProjectConfig => ({
  schemaVersion: 1,
  project: { name: 'maintenance-app', packageManager: 'npm' },
  capabilities: {
    foundation: { recipe: 'foundation.nest', options: {} },
    database: { recipe: 'database.postgres', options: {} },
    auth: { recipe: 'auth.local', options: {} },
    mail: { recipe: 'mail.capture', options: { reliableActions: false } },
  },
});
const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
async function controlledCatalog(
  version: '0.1.0' | typeof TOOL_VERSION,
): Promise<RecipeCatalog> {
  const migration = await migrations();
  const currentTemplate = await readFile(
    'templates/runtime/common/src/modules/mail/render-message.ts',
    'utf8',
  );
  assert.equal(
    migration.previewSourceMigration(
      migration.COPIED_MAIL_MIGRATION,
      currentTemplate,
    ).status,
    'already-applied',
  );
  const source =
    version === '0.1.0'
      ? currentTemplate.replace(
          migration.MAIL_RENDERING_NEW,
          migration.MAIL_RENDERING_OLD,
        )
      : currentTemplate;
  const authManifest = JSON.parse(
    await readFile('packages/auth-runtime/package.json', 'utf8'),
  );
  authManifest.version = version;
  const runtime: RenderedFile[] = [];
  for (const file of [
    'index.js',
    'opaque.js',
    'errors.js',
    'auth-runtime-error.js',
  ])
    runtime.push({
      path: `tools/vcli-auth-runtime/dist/${file}`,
      ownership: 'managed',
      content: await readFile(
        `${maintenanceFixture}/auth-${version}/dist/${file}`,
        'utf8',
      ),
    });
  return {
    recipes: Object.entries(config().capabilities).map(
      ([family, selected]) => ({
        id: selected.recipe,
        family,
        version: TOOL_VERSION,
        requires: family === 'foundation' ? [] : ['foundation'],
        conflicts: [],
        validateOptions: (options) => {
          assert.ok(
            options && typeof options === 'object' && !Array.isArray(options),
          );
          return structuredClone(options) as Record<string, never>;
        },
      }),
    ),
    async render(selected) {
      return {
        files: [
          {
            path: 'package.json',
            ownership: 'managed',
            content: json({
              name: selected.project.name,
              private: true,
              type: 'module',
              scripts: { typecheck: 'node -e "process.exit(0)"' },
              dependencies: {
                '@vcli/auth-runtime': 'file:tools/vcli-auth-runtime',
              },
              devDependencies: { '@vcli/cli': 'file:tools/vcli' },
            }),
          },
          {
            path: 'tools/vcli/package.json',
            ownership: 'managed',
            content: json({
              name: '@vcli/cli',
              version: TOOL_VERSION,
              type: 'module',
            }),
          },
          {
            path: 'tools/vcli-auth-runtime/package.json',
            ownership: 'managed',
            content: json(authManifest),
          },
          ...runtime,
          {
            path: 'src/modules/mail/render-message.ts',
            ownership: 'scaffold',
            content: source,
          },
          {
            path: 'src/app.custom.module.ts',
            ownership: 'scaffold',
            content: '// Custom integration\n',
          },
          {
            path: 'src/generated/vcli-app.module.ts',
            ownership: 'managed',
            content: `// explicit registration ${version}\n`,
          },
          {
            path: 'README.md',
            ownership: 'managed',
            content: `# App\n<!-- vcli:managed:start -->\nToolkit ${version}\n<!-- vcli:managed:end -->\nDeveloper notes\n`,
          },
          {
            path: '.env.production.example',
            ownership: 'managed',
            content: 'NODE_ENV=production\n',
          },
        ],
        checks: [
          { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
        ],
        warnings: [],
        pending: [],
      };
    },
  };
}
async function componentProject(
  t: import('node:test').TestContext,
): Promise<string> {
  const e = await engine();
  const root = await mkdtemp(path.join(maintenanceFixture, 'project-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'app');
  await e.applyPlan(
    await e.planInit({
      workspaceDir: root,
      projectDir: project,
      config: config(),
      catalog: await controlledCatalog('0.1.0'),
    }),
  );
  const file = path.join(project, 'vcli.lock.json');
  const lock = JSON.parse(await readFile(file, 'utf8'));
  // Active private1.1 project carrying known copied/auth0.1.0 components.
  lock.toolVersion = '0.1.1';
  await writeFile(file, json(lock));
  return project;
}
async function failure(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === code,
  );
}
async function fakeInstall(project: string): Promise<void> {
  const manifest = JSON.parse(
    await readFile(path.join(project, 'package.json'), 'utf8'),
  );
  const packages: Record<string, unknown> = {
    '': {
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    },
  };
  const installed: Record<string, unknown> = {};
  for (const [name, source] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    assert.equal(typeof source, 'string');
    assert.ok((source as string).startsWith('file:'));
    const local = path.join(project, (source as string).slice(5));
    const target = path.join(project, 'node_modules', name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(local, target, { recursive: true });
    const facts = JSON.parse(
      await readFile(path.join(local, 'package.json'), 'utf8'),
    );
    packages[`node_modules/${name}`] = {
      version: facts.version,
      resolved: source,
    };
    installed[`node_modules/${name}`] = {
      version: facts.version,
      resolved: source,
    };
  }
  await writeFile(
    path.join(project, 'package-lock.json'),
    json({ lockfileVersion: 3, packages }),
  );
  await writeFile(
    path.join(project, 'node_modules/.package-lock.json'),
    json({ lockfileVersion: 3, packages: installed }),
  );
}

test('curated release support and compatible auth package API exercise retain optional peer-free imports', async () => {
  const m = await maintenance();
  assert.deepEqual(m.getSupportCatalog().edges, [
    {
      from: '0.1.0',
      to: '0.1.1',
      migration: 'private-patch-0-1-1',
      baselineProfiles: ['curated-capture-immediate-v1'],
    },
    {
      from: '0.1.0',
      to: TOOL_VERSION,
      migration: 'private-patch-0-1-2',
      baselineProfiles: ['curated-capture-immediate-v1'],
    },
    {
      from: '0.1.1',
      to: TOOL_VERSION,
      migration: 'private-patch-0-1-2',
      baselineProfiles: ['matching-managed-project'],
    },
  ]);
  const modules = await Promise.all(
    ['0.1.0', TOOL_VERSION].map(async (version) => ({
      root: (await import(
        pathToFileURL(`${maintenanceFixture}/auth-${version}/dist/index.js`)
          .href
      )) as typeof import('../packages/auth-runtime/src/index.ts'),
      opaque: (await import(
        pathToFileURL(`${maintenanceFixture}/auth-${version}/dist/opaque.js`)
          .href
      )) as typeof import('../packages/auth-runtime/src/opaque.ts'),
    })),
  );
  const value = modules[0]!.opaque.createOpaqueCapability();
  assert.equal(value.length, 43);
  const digest = modules[0]!.opaque.hashOpaqueCapability(value, 'action-token');
  assert.equal(
    modules[1]!.opaque.hashOpaqueCapability(value, 'action-token'),
    digest,
  );
  assert.equal(
    modules[1]!.opaque.opaqueCapabilityMatches(value, digest, 'action-token'),
    true,
  );
  assert.equal(
    modules[1]!.opaque.opaqueCapabilityMatches(value, digest, 'refresh-token'),
    false,
  );
  for (const module of modules)
    assert.throws(
      () =>
        module.opaque.hashOpaqueCapability(
          'PRIVATE_INVALID_CAPABILITY',
          'action-token',
        ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_OPAQUE_CAPABILITY' &&
        !JSON.stringify(error).includes('PRIVATE_INVALID'),
    );
  assert.equal(modules[0]!.root.AUTH_RUNTIME_VERSION, undefined);
  assert.equal(modules[1]!.root.AUTH_RUNTIME_VERSION, TOOL_VERSION);
});

test('AST codemod recognizes executable supported shapes, preserves adjacent custom code, refuses embedded or customized source', async () => {
  const s = await migrations();
  const before =
    '// developer prefix\nexport const userSetting = 9;\n' +
    s.MAIL_RENDERING_OLD +
    '\n// developer suffix\n';
  const result = s.previewSourceMigration(s.COPIED_MAIL_MIGRATION, before);
  assert.equal(result.status, 'supported');
  assert.equal(
    result.content,
    before.replace(
      s.MAIL_RENDERING_OLD.trimEnd(),
      s.MAIL_RENDERING_NEW.trimEnd(),
    ),
  );
  assert.equal(
    s.previewSourceMigration(s.COPIED_MAIL_MIGRATION, result.content!).status,
    'already-applied',
  );
  for (const input of [
    JSON.stringify(s.MAIL_RENDERING_OLD),
    `/* ${s.MAIL_RENDERING_OLD} */`,
    s.MAIL_RENDERING_OLD.replace('32768', '65535'),
    s.MAIL_RENDERING_OLD + s.MAIL_RENDERING_OLD,
  ])
    assert.equal(
      s.previewSourceMigration(s.COPIED_MAIL_MIGRATION, input).status,
      'manual',
    );
  assert.throws(
    () => s.getSourceMigration('copied.arbitrary-plugin'),
    /INVALID_PLAN/,
  );
});

test('compatible component patch preview is pure, package/custom prose survive, copied patch applies and repeat is idempotent', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance(),
    s = await migrations();
  const custom =
    '// customized integration remains\nexport const sentinel = "USER_CODE_457";\n';
  await writeFile(path.join(project, 'src/app.custom.module.ts'), custom);
  const sourcePath = path.join(project, s.COPIED_MAIL_PATH);
  const initialSource =
    '// custom header remains\n' + (await readFile(sourcePath, 'utf8'));
  await writeFile(sourcePath, initialSource);
  const manifest = JSON.parse(
    await readFile(path.join(project, 'package.json'), 'utf8'),
  );
  manifest.scripts.custom = 'echo custom';
  manifest.custom = { preserve: true };
  await writeFile(path.join(project, 'package.json'), json(manifest));
  await writeFile(
    path.join(project, 'README.md'),
    (await readFile(path.join(project, 'README.md'), 'utf8')).replace(
      'Developer notes',
      'Private developer notes',
    ),
  );
  await writeFile(
    path.join(project, '.env.production'),
    'ENV_PRIVATE_SENTINEL=do-not-log',
  );
  await fakeInstall(project);
  await e.installProject(project, { runner: async () => ({ exitCode: 0 }) });
  assert.equal((await e.inspectProject(project)).outcomes.install, 'completed');
  const entries = await readdir(path.join(project, '.vcli/local/operations'));
  const result = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  assert.deepEqual(
    await readdir(path.join(project, '.vcli/local/operations')),
    entries,
  );
  assert.equal(result.plan.outcomes.install, 'pending'); // file: dependency string remains unchanged.
  assert.equal(result.codemods[0]?.status, 'planned');
  const summary = JSON.stringify(m.summarizeMaintenancePlan(result));
  assert.ok(!summary.includes('ENV_PRIVATE_SENTINEL'));
  assert.ok(!summary.includes('process.exit'));
  assert.ok(!summary.includes(project));
  await e.applyPlan(result.plan);
  assert.equal(
    await readFile(sourcePath, 'utf8'),
    initialSource.replace(
      s.MAIL_RENDERING_OLD.trimEnd(),
      s.MAIL_RENDERING_NEW.trimEnd(),
    ),
  );
  assert.equal(
    await readFile(path.join(project, 'src/app.custom.module.ts'), 'utf8'),
    custom,
  );
  assert.ok(
    (await readFile(path.join(project, 'README.md'), 'utf8')).includes(
      'Private developer notes',
    ),
  );
  const afterPackage = JSON.parse(
    await readFile(path.join(project, 'package.json'), 'utf8'),
  );
  assert.equal(afterPackage.scripts.custom, 'echo custom');
  assert.deepEqual(afterPackage.custom, { preserve: true });
  const snapshot = await m.inspectMaintenance(project);
  const findings = m.reportAdvisories(snapshot);
  assert.equal(
    findings.find((finding) => finding.component === 'copied-mail-rendering')
      ?.status,
    'fixed',
  );
  assert.equal(
    findings.find((finding) => finding.component === 'auth-runtime')?.status,
    'source-fixed-install-pending',
  );
  const repeat = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  assert.deepEqual(repeat.plan.changes, []);
  await e.installProject(project, {
    runner: async () => {
      await fakeInstall(project);
      return { exitCode: 0 };
    },
  });
  assert.equal(
    m
      .reportAdvisories(await m.inspectMaintenance(project))
      .find((finding) => finding.component === 'auth-runtime')?.status,
    'fixed',
  );
});

test('customized sensitive function yields a private reviewable manual patch and unknown advisory state', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance(),
    s = await migrations();
  const target = path.join(project, s.COPIED_MAIL_PATH);
  const custom = (await readFile(target, 'utf8')).replace('32768', '65535');
  await writeFile(target, custom);
  const result = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  assert.equal(result.codemods.length, 0);
  assert.equal(result.manual.length, 1);
  assert.ok(
    !result.plan.changes.some(({ path }) => path === s.COPIED_MAIL_PATH),
  );
  await e.applyPlan(result.plan);
  assert.equal(await readFile(target, 'utf8'), custom);
  const patch = await readFile(
    path.join(project, result.manual[0]!.patchPath),
    'utf8',
  );
  assert.ok(patch.includes('DEMONSTRATION'));
  assert.ok(patch.includes('--- a/src/modules/mail/render-message.ts'));
  assert.ok(!patch.includes('65535'));
  assert.equal(
    m
      .reportAdvisories(await m.inspectMaintenance(project))
      .find((finding) => finding.component === 'copied-mail-rendering')?.status,
    'unknown',
  );
});

test('unknown releases/gaps, wrong target assets, desired provider switch and selected dependency drift refuse without mutation', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance();
  const target = await controlledCatalog(TOOL_VERSION);
  await failure(
    () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: 'latest',
        catalog: target,
      }),
    'UNSUPPORTED_RELEASE',
  );
  await failure(
    () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: controlledMissingAssets(target),
      }),
    'TARGET_ASSET_MISMATCH',
  );
  const packagePath = path.join(project, 'package.json');
  const original = await readFile(packagePath, 'utf8');
  const changed = JSON.parse(original);
  changed.dependencies['@vcli/auth-runtime'] = '9.9.9';
  await writeFile(packagePath, json(changed));
  await failure(
    () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: target,
      }),
    'MANAGED_CONFLICT',
  );
  await writeFile(packagePath, original);
  const desired = config();
  desired.capabilities.database!.recipe = 'database.mongodb';
  await writeFile(path.join(project, 'vcli.json'), json(desired));
  await failure(
    () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: target,
      }),
    'STATE_DRIFT',
  );
  await writeFile(path.join(project, 'vcli.json'), json(config()));
  const lockPath = path.join(project, 'vcli.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.recipes[0].version = '0.0.9';
  await writeFile(lockPath, json(lock));
  await failure(
    () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: target,
      }),
    'UNSUPPORTED_RELEASE',
  );
  assert.equal((await e.inspectProject(project)).outcomes.source, 'completed');
});
function controlledMissingAssets(target: RecipeCatalog): RecipeCatalog {
  return {
    recipes: target.recipes,
    async render(config, resolved) {
      const result = await target.render(config, resolved);
      result.files = result.files.filter(
        ({ path }) => path !== 'tools/vcli-auth-runtime/package.json',
      );
      return result;
    },
  };
}

test('saved copied-source migration rechecks finite IDs and touched source bytes; ordinary recovery preserves later edits', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance(),
    s = await migrations();
  const result = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  const saved = path.join(path.dirname(project), 'upgrade-plan.json');
  await e.savePlan(result.plan, saved);
  assert.equal((await stat(saved)).mode & 0o777, 0o600);
  const forged = structuredClone(result.plan);
  forged.sourceMigrations![0]!.id = 'copied.unreviewed';
  assert.throws(() => e.validatePlan(forged), /INVALID_PLAN/);
  const source = path.join(project, s.COPIED_MAIL_PATH);
  const before = await readFile(source, 'utf8');
  await writeFile(source, '// editor intervened\n' + before);
  await failure(() => e.applyPlan(result.plan), 'MANAGED_CONFLICT');
  assert.equal(
    await readFile(source, 'utf8'),
    '// editor intervened\n' + before,
  );
  await writeFile(source, before);
  const writeCount =
    result.plan.changes.findIndex(({ path }) => path === s.COPIED_MAIL_PATH) +
    1;
  await failure(
    async () =>
      e.applyPlan(await e.readPlan(saved), { failAfterWrites: writeCount }),
    'SOURCE_FAILED',
  );
  await writeFile(source, '// later editor change\n');
  const recovered = await e.recoverOperation(project);
  assert.equal(recovered.status, 'conflicted');
  assert.ok(recovered.conflicts.includes(s.COPIED_MAIL_PATH));
  assert.equal(await readFile(source, 'utf8'), '// later editor change\n');
});

test('installation failure after upgrade stays failed across repeat, and source recovery preserves later copied edits', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance(),
    s = await migrations();
  const result = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  await e.applyPlan(result.plan);
  await failure(
    () =>
      e.installProject(project, {
        runner: async () => {
          throw new Error('PRIVATE_INSTALL_FAILURE');
        },
      }),
    'INSTALL_FAILED',
  );
  const repeat = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  assert.deepEqual(repeat.plan.changes, []);
  assert.equal((await e.applyPlan(repeat.plan)).outcomes.install, 'failed');
  await writeFile(
    path.join(project, s.COPIED_MAIL_PATH),
    '// after install failure developer edit\n',
  );
  const recovered = await e.recoverOperation(project, {
    operationId: result.plan.id,
  });
  assert.equal(recovered.status, 'conflicted');
  assert.equal(
    await readFile(path.join(project, s.COPIED_MAIL_PATH), 'utf8'),
    '// after install failure developer edit\n',
  );
});

test('curated runtime asset and installed-code drift cannot be called advisory remediation', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance();
  const asset = path.join(project, 'tools/vcli-auth-runtime/dist/opaque.js');
  const original = await readFile(asset, 'utf8');
  await writeFile(asset, '// customized sensitive package code\n');
  const inventory = await m.inspectMaintenance(project);
  assert.equal(
    inventory.components.find((component) => component.id === 'auth-runtime')
      ?.version,
    'unknown',
  );
  assert.equal(
    m
      .reportAdvisories(inventory)
      .find((finding) => finding.component === 'auth-runtime')?.status,
    'unknown',
  );
  await failure(
    async () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: await controlledCatalog(TOOL_VERSION),
      }),
    'MAINTENANCE_STATE_INVALID',
  );
  await writeFile(asset, original);
  const planned = await m.planMaintenanceUpgrade({
    projectDir: project,
    targetVersion: TOOL_VERSION,
    catalog: await controlledCatalog(TOOL_VERSION),
  });
  await e.applyPlan(planned.plan);
  await e.installProject(project, {
    runner: async () => {
      await fakeInstall(project);
      return { exitCode: 0 };
    },
  });
  await writeFile(
    path.join(project, 'node_modules/@vcli/auth-runtime/dist/opaque.js'),
    '// installed corruption\n',
  );
  const corrupted = await m.inspectMaintenance(project);
  assert.equal(
    corrupted.components.find((component) => component.id === 'auth-runtime')
      ?.installation,
    'failed',
  );
  assert.notEqual(
    m
      .reportAdvisories(corrupted)
      .find((finding) => finding.component === 'auth-runtime')?.status,
    'fixed',
  );
});

test('historical bootstrap capability baseline refuses before writes even after default option normalization', async (t) => {
  const project = await componentProject(t);
  const m = await maintenance();
  const lockPath = path.join(project, 'vcli.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.toolVersion = '0.1.0';
  lock.files['tools/vcli/dist/recipes/render-capabilities.js'] = {
    ownership: 'managed',
    hash: 'd9de1993df0ff710af102c327ae088b402e28fb25fe11713fa270390478a1b0a',
  };
  await writeFile(lockPath, json(lock));
  const before = await readFile(lockPath, 'utf8');
  const journals = await readdir(path.join(project, '.vcli/local/operations'));
  await failure(
    async () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: await controlledCatalog(TOOL_VERSION),
      }),
    'UNSUPPORTED_BASELINE',
  );
  assert.equal(await readFile(lockPath, 'utf8'), before);
  assert.deepEqual(
    await readdir(path.join(project, '.vcli/local/operations')),
    journals,
  );
});

test('unrecognized old capability contracts refuse without relying on one historical artifact fingerprint', async (t) => {
  const project = await componentProject(t);
  const m = await maintenance();
  const lockPath = path.join(project, 'vcli.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.toolVersion = '0.1.0';
  for (const recipe of lock.recipes) recipe.version = '0.1.0';
  await writeFile(lockPath, json(lock));
  const before = await readFile(lockPath, 'utf8');
  await failure(
    async () =>
      m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: await controlledCatalog(TOOL_VERSION),
      }),
    'UNSUPPORTED_BASELINE',
  );
  assert.equal(await readFile(lockPath, 'utf8'), before);
});

test('installer re-resolves only selected managed file dependencies and refuses npm manifest drift', async (t) => {
  const project = await componentProject(t);
  const e = await engine();
  const manifestPath = path.join(project, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies['custom-local'] = 'file:vendor/custom-local';
  await mkdir(path.join(project, 'vendor/custom-local'), { recursive: true });
  await writeFile(
    path.join(project, 'vendor/custom-local/package.json'),
    json({ name: 'custom-local', version: '1.0.0' }),
  );
  await writeFile(manifestPath, json(manifest));
  let calls = 0;
  await e.installProject(project, {
    runner: async (request) => {
      calls++;
      if (calls === 1) {
        assert.ok(request.args.includes('@vcli/cli@file:tools/vcli'));
        assert.ok(
          request.args.includes(
            '@vcli/auth-runtime@file:tools/vcli-auth-runtime',
          ),
        );
      } else
        assert.deepEqual(request.args, [
          'install',
          '--no-audit',
          '--no-fund',
          '--install-links',
        ]);
      assert.ok(
        !request.args.some((argument) => argument.startsWith('custom-local@')),
      );
      await fakeInstall(project);
      return { exitCode: 0 };
    },
  });
  assert.equal(calls, 2);
  const after = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(after.dependencies['custom-local'], 'file:vendor/custom-local');
  assert.equal(after.devDependencies['@vcli/cli'], 'file:tools/vcli');
  await failure(
    () =>
      e.installProject(project, {
        runner: async () => {
          const changed = JSON.parse(await readFile(manifestPath, 'utf8'));
          changed.dependencies['@vcli/auth-runtime'] = '9.9.9';
          await writeFile(manifestPath, json(changed));
          return { exitCode: 0 };
        },
      }),
    'INSTALL_FAILED',
  );
});

test('same-version managed package payload drift stays pending until installed bytes match source', async (t) => {
  const project = await componentProject(t);
  const e = await engine(),
    m = await maintenance();
  const target = await controlledCatalog(TOOL_VERSION);
  await e.applyPlan(
    (
      await m.planMaintenanceUpgrade({
        projectDir: project,
        targetVersion: TOOL_VERSION,
        catalog: target,
      })
    ).plan,
  );
  await e.installProject(project, {
    runner: async () => {
      await fakeInstall(project);
      return { exitCode: 0 };
    },
  });
  const updated: RecipeCatalog = {
    recipes: target.recipes,
    async render(config, resolved) {
      const result = await target.render(config, resolved);
      const file = result.files.find(
        (entry) => entry.path === 'tools/vcli-auth-runtime/dist/opaque.js',
      )!;
      file.content += '\n// SAME_VERSION_PAYLOAD\n';
      return result;
    },
  };
  await e.applyPlan(
    await e.planUpgrade({ projectDir: project, catalog: updated }),
  );
  const inspector =
    await maintenanceModule<typeof import('../src/engine/inspection.ts')>(
      'engine/inspection',
    );
  assert.equal(await inspector.installationHealthy(project), false);
  assert.notEqual(
    (await e.inspectProject(project)).outcomes.install,
    'completed',
  );
  assert.notEqual(
    m
      .reportAdvisories(await m.inspectMaintenance(project))
      .find((finding) => finding.component === 'auth-runtime')?.status,
    'fixed',
  );
  const calls: { args: readonly string[] }[] = [];
  await e.installProject(project, {
    runner: async (request) => {
      calls.push(request);
      await fakeInstall(project);
      return { exitCode: 0 };
    },
  });
  assert.equal(calls[0]?.args[0], 'uninstall');
  assert.ok(calls[0]!.args.includes('--no-save'));
  assert.ok(calls[0]!.args.includes('--package-lock=false'));
  assert.ok(calls[0]!.args.includes('@vcli/auth-runtime'));
  assert.ok(!calls[0]!.args.includes('@vcli/cli'));

  assert.equal(await inspector.installationHealthy(project), true);
  assert.equal(
    m
      .reportAdvisories(await m.inspectMaintenance(project))
      .find((finding) => finding.component === 'auth-runtime')?.status,
    'fixed',
  );
});

test('changed managed local source manifest blocks before pending state or any npm call', async (t) => {
  const project = await componentProject(t);
  const e = await engine();
  const lockPath = path.join(project, 'vcli.lock.json'),
    manifestPath = path.join(project, 'tools/vcli/package.json');
  const before = await readFile(lockPath, 'utf8');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.name = 'unreviewed-package';
  manifest.scripts = { preinstall: 'node -e "process.exit(99)"' };
  await writeFile(manifestPath, json(manifest));
  let calls = 0;
  const runner = async () => {
    calls++;
    return { exitCode: 0 };
  };
  await failure(
    () => e.installProject(project, { runner }),
    'MANAGED_CONFLICT',
  );
  assert.equal(calls, 0);
  assert.equal(await readFile(lockPath, 'utf8'), before);
  const lock = JSON.parse(before);
  lock.files['tools/vcli/package.json'].hash = createHash('sha256')
    .update(await readFile(manifestPath))
    .digest('hex');
  await writeFile(lockPath, json(lock));
  const renamedBefore = await readFile(lockPath, 'utf8');
  await failure(
    () => e.installProject(project, { runner }),
    'MANAGED_CONFLICT',
  );
  assert.equal(calls, 0);
  assert.equal(await readFile(lockPath, 'utf8'), renamedBefore);
});

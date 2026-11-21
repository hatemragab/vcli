import assert from 'node:assert/strict';
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
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type {
  Recipe,
  RecipeCatalog,
  ProjectConfig,
  RenderedProject,
} from '../src/contracts.ts';
import {
  applyPlan,
  checkProject,
  doctorProject,
  EngineError,
  inspectProject,
  installProject,
  planAdd,
  planInit,
  planScaffold,
  planUpgrade,
  readPlan,
  recoverOperation,
  resolveRecipes,
  savePlan,
  summarizePlan,
  validateConfig,
  validateIdentifier,
  validatePlan,
  validateToolchain,
} from '../dist/engine/index.js';
import type { CommandRunner, GenerationPlan } from '../dist/engine/types.js';

const baseConfig = (): ProjectConfig => ({
  schemaVersion: 1,
  project: { name: 'test-api', packageManager: 'npm' },
  capabilities: { foundation: { recipe: 'foundation.nest', options: {} } },
});
const recipe = (
  id: string,
  family: string,
  requires: string[] = [],
): Recipe => ({
  id,
  family,
  version: '0.1.0',
  requires,
  conflicts: [],
  validateOptions: (options) => {
    assert.deepEqual(options, {});
    return {};
  },
});
const foundation = recipe('foundation.nest', 'foundation');
const mail = recipe('mail.capture', 'mail', ['foundation']);
function catalog(version = '0.1.0'): RecipeCatalog {
  return {
    recipes: [{ ...foundation, version }, mail],
    async render(config): Promise<RenderedProject> {
      const hasMail = !!config.capabilities.mail;
      const files: RenderedProject['files'] = [
        {
          path: 'package.json',
          ownership: 'managed',
          content: JSON.stringify({
            name: config.project.name,
            version: '1.0.0',
            private: true,
            scripts: {
              typecheck: 'node -e "process.exit(0)"',
              ...(hasMail ? { mail: 'node -e "process.exit(0)"' } : {}),
            },
            dependencies: {
              'fixture-dep': '1.0.0',
              ...(hasMail ? { 'fixture-mail': '2.0.0' } : {}),
            },
          }),
        },
        {
          path: 'src/generated/vcli-app.module.ts',
          ownership: 'managed',
          content: `// ${hasMail ? 'mail' : 'foundation'} ${version}\n`,
        },
        {
          path: 'src/app.custom.module.ts',
          ownership: 'scaffold',
          content: '// custom seam\n',
        },
        {
          path: 'README.md',
          ownership: 'managed',
          content: `# Project\n<!-- vcli:managed:start -->\n${hasMail ? 'mail' : 'foundation'} ${version}\n<!-- vcli:managed:end -->\nUser notes\n`,
        },
        {
          path: '.env.development.example',
          ownership: 'managed',
          content: 'NODE_ENV=development\n',
        },
        {
          path: '.env.production.example',
          ownership: 'managed',
          content: 'NODE_ENV=production\n',
        },
        {
          path: '.gitignore',
          ownership: 'managed',
          content: '.vcli/local/\n.env*\nnode_modules/\n',
        },
      ];
      if (hasMail)
        files.push({
          path: 'src/mail.service.ts',
          ownership: 'scaffold',
          content: '// mail scaffold\n',
        });
      return {
        files,
        checks: [
          { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
        ],
        warnings: [],
        pending: hasMail
          ? ['Import mail explicitly into custom consumers.']
          : [],
      };
    },
  };
}
async function workspace(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vcli-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function init(
  t: test.TestContext,
): Promise<{ root: string; project: string; plan: GenerationPlan }> {
  const root = await workspace(t);
  const project = path.join(root, 'sample');
  const plan = await planInit({
    workspaceDir: root,
    projectDir: project,
    config: baseConfig(),
    catalog: catalog(),
  });
  await applyPlan(plan);
  return { root, project, plan };
}
async function rejectsCode(
  action: () => unknown | Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(
    async () => {
      await action();
    },
    (error: unknown) => error instanceof EngineError && error.code === code,
  );
}
async function fakeInstallation(project: string): Promise<void> {
  const manifest: {
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
  } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  const packages: Record<string, unknown> = {
    '': {
      dependencies: manifest.dependencies,
      ...(manifest.devDependencies
        ? { devDependencies: manifest.devDependencies }
        : {}),
    },
  };
  const installed: Record<string, unknown> = {};
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    packages[`node_modules/${name}`] = { version, integrity: `sha512-${name}` };
    installed[`node_modules/${name}`] = {
      version,
      integrity: `sha512-${name}`,
    };
    await mkdir(path.join(project, 'node_modules', name), { recursive: true });
    await writeFile(
      path.join(project, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version }),
    );
  }
  await writeFile(
    path.join(project, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
  await mkdir(path.join(project, 'node_modules'), { recursive: true });
  await writeFile(
    path.join(project, 'node_modules/.package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: installed }),
  );
}

test('init preview is read-only and source-only init/inspect/doctor report pending install/checks', async (t) => {
  const root = await workspace(t);
  const project = path.join(root, 'sample');
  const before = await readdir(root);
  const plan = await planInit({
    workspaceDir: root,
    projectDir: project,
    config: baseConfig(),
    catalog: catalog(),
  });
  assert.deepEqual(await readdir(root), before);
  await assert.rejects(stat(project));
  const summary = JSON.stringify(summarizePlan(plan));
  assert.ok(!summary.includes('process.exit'));
  assert.ok(!summary.includes(root));
  const applied = await applyPlan(plan);
  assert.deepEqual(applied.outcomes, {
    source: 'completed',
    install: 'pending',
    checks: 'pending',
  });
  const inspected = await inspectProject(project);
  assert.equal(inspected.outcomes.install, 'pending');
  assert.equal(
    (await doctorProject(project)).issues[0]?.code,
    'INSTALL_INCOMPLETE',
  );
  await rejectsCode(() => checkProject(project), 'INSTALL_INCOMPLETE');
  const current = path.join(root, 'current');
  await mkdir(current);
  await mkdir(path.join(current, '.git'));
  const currentPlan = await planInit({
    workspaceDir: current,
    projectDir: '.',
    config: baseConfig(),
    catalog: catalog(),
  });
  await applyPlan(currentPlan);
  assert.ok((await stat(path.join(current, '.git'))).isDirectory());
});

test('explicit resolution rejects missing family, cycle, conflicting/unknown IDs and malformed options', async () => {
  const config = baseConfig();
  config.capabilities.auth = { recipe: 'auth.local', options: {} };
  await rejectsCode(
    () =>
      resolveRecipes(config, {
        ...catalog(),
        recipes: [foundation, recipe('auth.local', 'auth', ['database'])],
      }),
    'MISSING_CAPABILITY',
  );
  await rejectsCode(
    () =>
      resolveRecipes(baseConfig(), {
        ...catalog(),
        recipes: [foundation, foundation],
      }),
    'INVALID_CATALOG',
  );
  await rejectsCode(
    () =>
      resolveRecipes(
        {
          ...baseConfig(),
          capabilities: { foundation: { recipe: 'missing', options: {} } },
        },
        catalog(),
      ),
    'UNKNOWN_RECIPE',
  );
  const cycle = {
    ...baseConfig(),
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      mail: { recipe: 'mail.capture', options: {} },
    },
  };
  await rejectsCode(
    () =>
      resolveRecipes(cycle, {
        ...catalog(),
        recipes: [{ ...foundation, requires: ['mail'] }, mail],
      }),
    'RECIPE_CYCLE',
  );
  await rejectsCode(
    () =>
      resolveRecipes(cycle, {
        ...catalog(),
        recipes: [{ ...foundation, conflicts: ['mail.capture'] }, mail],
      }),
    'RECIPE_CONFLICT',
  );
  await rejectsCode(
    () =>
      resolveRecipes(
        {
          ...baseConfig(),
          capabilities: {
            foundation: { recipe: 'foundation.nest', options: { bad: true } },
          },
        },
        catalog(),
      ),
    'INVALID_OPTIONS',
  );
  await rejectsCode(
    () =>
      resolveRecipes(
        {
          ...baseConfig(),
          capabilities: { foundation: { recipe: 'mail.capture', options: {} } },
        },
        catalog(),
      ),
    'RECIPE_CONFLICT',
  );
  assert.deepEqual(
    resolveRecipes(cycle, {
      ...catalog(),
      recipes: [mail, foundation],
    }).recipes.map(({ id }) => id),
    ['foundation.nest', 'mail.capture'],
  );
});

test('nonempty destinations, escaping paths, symlinks and unsafe identifiers fail without writes', async (t) => {
  const root = await workspace(t);
  const project = path.join(root, 'sample');
  await mkdir(project);
  await writeFile(path.join(project, 'sentinel'), 'keep');
  const options = {
    workspaceDir: root,
    projectDir: project,
    config: baseConfig(),
    catalog: catalog(),
  };
  await rejectsCode(() => planInit(options), 'NONEMPTY_DESTINATION');
  await rejectsCode(
    () => planInit({ ...options, projectDir: '../escape' }),
    'UNSAFE_PATH',
  );
  await symlink(project, path.join(root, 'linked'));
  await rejectsCode(
    () => planInit({ ...options, projectDir: path.join(root, 'linked') }),
    'UNSAFE_PATH',
  );
  await rejectsCode(
    () => validateIdentifier('orders;echo-sentinel'),
    'INVALID_IDENTIFIER',
  );
  await rejectsCode(
    () => validateConfig({ ...baseConfig(), schemaVersion: 3 }),
    'UNSUPPORTED_SCHEMA',
  );
  await rejectsCode(() => validateToolchain('24.0.0'), 'UNSUPPORTED_TOOLCHAIN');
  const dotGit = path.join(root, 'git-symlink');
  await mkdir(dotGit);
  await symlink(project, path.join(dotGit, '.git'));
  await rejectsCode(
    () => planInit({ ...options, projectDir: dotGit }),
    'UNSAFE_PATH',
  );
  assert.equal(await readFile(path.join(project, 'sentinel'), 'utf8'), 'keep');
});

test('appearing init files and every stale add precondition reject before any source write', async (t) => {
  const root = await workspace(t);
  const project = path.join(root, 'sample');
  const plan = await planInit({
    workspaceDir: root,
    projectDir: project,
    config: baseConfig(),
    catalog: catalog(),
  });
  await mkdir(project);
  await writeFile(path.join(project, 'later'), 'new');
  await rejectsCode(() => applyPlan(plan), 'NONEMPTY_DESTINATION');
  await assert.rejects(stat(path.join(project, '.vcli')));
  const initialized = await init(t);
  const add = await planAdd({
    projectDir: initialized.project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  await writeFile(
    path.join(initialized.project, 'src/mail.service.ts'),
    'developer won',
  );
  await rejectsCode(() => applyPlan(add), 'STALE_PLAN');
  assert.equal(
    await readFile(
      path.join(initialized.project, 'src/generated/vcli-app.module.ts'),
      'utf8',
    ),
    '// foundation 0.1.0\n',
  );
  await rm(path.join(initialized.project, 'src/mail.service.ts'));
  await writeFile(
    path.join(initialized.project, 'src/generated/vcli-app.module.ts'),
    'managed edit',
  );
  await rejectsCode(() => applyPlan(add), 'STALE_PLAN');
});

test('add preserves custom module bytes, unrelated JSON and unmarked documentation; re-add is idempotent', async (t) => {
  const { project } = await init(t);
  const custom = '// completely customized\nexport const custom = 42;\n';
  await writeFile(path.join(project, 'src/app.custom.module.ts'), custom);
  const packageFile = path.join(project, 'package.json');
  const manifest = JSON.parse(await readFile(packageFile, 'utf8'));
  manifest.scripts.business = 'echo developer';
  manifest.dependencies.business = '3.0.0';
  manifest.custom = { keep: true };
  await writeFile(packageFile, JSON.stringify(manifest));
  const readmeFile = path.join(project, 'README.md');
  await writeFile(
    readmeFile,
    (await readFile(readmeFile, 'utf8')).replace(
      'User notes',
      'Private developer notes remain',
    ),
  );
  const plan = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  assert.ok(
    !plan.changes.some(({ path }) => path === 'src/app.custom.module.ts'),
  );
  await applyPlan(plan);
  assert.equal(
    await readFile(path.join(project, 'src/app.custom.module.ts'), 'utf8'),
    custom,
  );
  assert.ok(
    (await readFile(readmeFile, 'utf8')).includes(
      'Private developer notes remain',
    ),
  );
  const after = JSON.parse(await readFile(packageFile, 'utf8'));
  assert.equal(after.scripts.business, 'echo developer');
  assert.equal(after.dependencies.business, '3.0.0');
  assert.deepEqual(after.custom, { keep: true });
  await writeFile(
    path.join(project, 'src/mail.service.ts'),
    '// customized mail\n',
  );
  const repeat = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  assert.deepEqual(repeat.changes, []);
  assert.equal((await applyPlan(repeat)).outcomes.install, 'pending');
});

test('desired/realized drift, selected dependency drift and changed relevant regions are rejected', async (t) => {
  const { project } = await init(t);
  const packageFile = path.join(project, 'package.json');
  const initial = await readFile(packageFile, 'utf8');
  const manifest = JSON.parse(initial);
  manifest.dependencies['fixture-dep'] = '99.0.0';
  await writeFile(packageFile, JSON.stringify(manifest));
  await rejectsCode(
    () => planAdd({ projectDir: project, selections: {}, catalog: catalog() }),
    'MANAGED_CONFLICT',
  );
  await writeFile(packageFile, initial);
  const config = baseConfig();
  config.capabilities.mail = { recipe: 'mail.capture', options: {} };
  await writeFile(path.join(project, 'vcli.json'), JSON.stringify(config));
  await rejectsCode(
    () => planAdd({ projectDir: project, selections: {}, catalog: catalog() }),
    'STATE_DRIFT',
  );
  await writeFile(
    path.join(project, 'vcli.json'),
    JSON.stringify(baseConfig()),
  );
  await writeFile(
    path.join(project, 'README.md'),
    (await readFile(path.join(project, 'README.md'), 'utf8')).replace(
      'foundation 0.1.0',
      'edited managed region',
    ),
  );
  await rejectsCode(
    () =>
      planAdd({
        projectDir: project,
        selections: { mail: { recipe: 'mail.capture', options: {} } },
        catalog: catalog(),
      }),
    'MANAGED_CONFLICT',
  );
});

test('saved plans are explicit private writes; malformed/forged plans cause no filesystem effects', async (t) => {
  const root = await workspace(t);
  const project = path.join(root, 'sample');
  const plan = await planInit({
    workspaceDir: root,
    projectDir: project,
    config: baseConfig(),
    catalog: catalog(),
  });
  const saved = path.join(root, 'plan.json');
  await savePlan(plan, saved);
  assert.equal((await stat(saved)).mode & 0o777, 0o600);
  const loaded = await readPlan(saved);
  assert.deepEqual(loaded, plan);
  await assert.rejects(stat(project));
  for (const malicious of [
    '../escape',
    '/tmp/escape',
    'src/../../escape',
    '.env.production',
    '.git/config',
    '.vcli/local/forged',
    'src\\escape',
  ]) {
    const forged = structuredClone(plan);
    forged.changes[0]!.path = malicious;
    await rejectsCode(() => applyPlan(forged), 'UNSAFE_PATH');
    await assert.rejects(stat(project));
  }
  const forged = structuredClone(plan);
  forged.changes[0]!.content = 'tamper';
  await rejectsCode(() => validatePlan(forged), 'INVALID_PLAN');
  await applyPlan(loaded);
  await rejectsCode(() => applyPlan(loaded), 'NONEMPTY_DESTINATION');
});

test('interrupt after N changes is journaled and recovery removes only matching operation bytes', async (t) => {
  const { project } = await init(t);
  const before = await readFile(path.join(project, 'package.json'), 'utf8');
  const plan = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  await rejectsCode(
    () => applyPlan(plan, { failAfterWrites: 2 }),
    'SOURCE_FAILED',
  );
  await rejectsCode(
    () => planAdd({ projectDir: project, selections: {}, catalog: catalog() }),
    'INCOMPLETE_OPERATION',
  );
  const journalFile = path.join(
    project,
    '.vcli/local/operations',
    `${plan.id}.json`,
  );
  assert.equal((await stat(journalFile)).mode & 0o777, 0o600);
  const result = await recoverOperation(project);
  assert.equal(result.status, 'recovered');
  assert.equal(
    await readFile(path.join(project, 'package.json'), 'utf8'),
    before,
  );
  const fresh = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  await applyPlan(fresh);
  assert.equal((await inspectProject(project)).outcomes.source, 'completed');
});

test('recovery preserves later edits and reports actionable conflicts without reset/deletion', async (t) => {
  const { project } = await init(t);
  const plan = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  await rejectsCode(
    () => applyPlan(plan, { failAfterWrites: 1 }),
    'SOURCE_FAILED',
  );
  const first = plan.changes[0]!;
  await writeFile(path.join(project, first.path), 'later developer bytes\n');
  await writeFile(path.join(project, 'unrelated.txt'), 'keep forever');
  const result = await recoverOperation(project);
  assert.equal(result.status, 'conflicted');
  assert.ok(result.conflicts.includes(first.path));
  assert.equal(
    await readFile(path.join(project, first.path), 'utf8'),
    'later developer bytes\n',
  );
  assert.equal(
    await readFile(path.join(project, 'unrelated.txt'), 'utf8'),
    'keep forever',
  );
  await rejectsCode(
    () => planAdd({ projectDir: project, selections: {}, catalog: catalog() }),
    'INCOMPLETE_OPERATION',
  );
});

test('symlink ancestors appearing after planning and symlink targets are rejected', async (t) => {
  const { root, project } = await init(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  const plan = await planScaffold({
    projectDir: project,
    files: [
      {
        path: 'src/orders/order.service.ts',
        ownership: 'scaffold',
        content: '// new\n',
      },
    ],
  });
  await symlink(outside, path.join(project, 'src/orders'));
  await rejectsCode(() => applyPlan(plan), 'UNSAFE_PATH');
  assert.deepEqual(await readdir(outside), []);
  await rm(path.join(project, 'src/orders'));
  const targetPlan = await planScaffold({
    projectDir: project,
    files: [
      {
        path: 'src/order.service.ts',
        ownership: 'scaffold',
        content: '// new\n',
      },
    ],
  });
  await writeFile(path.join(outside, 'sentinel'), 'external');
  await symlink(
    path.join(outside, 'sentinel'),
    path.join(project, 'src/order.service.ts'),
  );
  await rejectsCode(() => applyPlan(targetPlan), 'UNSAFE_PATH');
  assert.equal(
    await readFile(path.join(outside, 'sentinel'), 'utf8'),
    'external',
  );
});

test('failed install remains failed across re-add; fake success cannot establish damaged installation', async (t) => {
  const { project } = await init(t);
  const sentinel = 'ENV_SENTINEL_DO_NOT_EXPOSE_8c789';
  const initialEnv = process.env.VCLI_ENGINE_SENTINEL;
  process.env.VCLI_ENGINE_SENTINEL = sentinel;
  t.after(() => {
    if (initialEnv === undefined) delete process.env.VCLI_ENGINE_SENTINEL;
    else process.env.VCLI_ENGINE_SENTINEL = initialEnv;
  });
  let failure: unknown;
  try {
    await installProject(project, {
      runner: async () => {
        throw new Error(sentinel);
      },
    });
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof EngineError);
  assert.equal(failure.code, 'INSTALL_FAILED');
  assert.ok(!JSON.stringify(failure).includes(sentinel));
  const repeated = await planAdd({
    projectDir: project,
    selections: {},
    catalog: catalog(),
  });
  assert.deepEqual(repeated.changes, []);
  assert.equal((await applyPlan(repeated)).outcomes.install, 'failed');
  await rejectsCode(
    () => installProject(project, { runner: async () => ({ exitCode: 0 }) }),
    'INSTALL_FAILED',
  );
  const inspection = await doctorProject(project);
  assert.equal(inspection.outcomes.install, 'failed');
  assert.ok(!JSON.stringify(inspection).includes(sentinel));
  assert.ok(!JSON.stringify(summarizePlan(repeated)).includes(sentinel));
});

test('explicit fake installation/checks record separate states and detect damaged dependencies', async (t) => {
  const { project } = await init(t);
  const runner: CommandRunner = async (request) => {
    assert.equal(request.command, 'npm');
    assert.equal(request.cwd, project);
    assert.deepEqual(request.args, [
      'install',
      '--no-audit',
      '--no-fund',
      '--install-links',
    ]);
    await fakeInstallation(project);
    return { exitCode: 0 };
  };
  const installed = await installProject(project, { runner });
  assert.deepEqual(installed.outcomes, {
    source: 'completed',
    install: 'completed',
    checks: 'pending',
  });
  await rejectsCode(
    () => checkProject(project, { runner: async () => ({ exitCode: 7 }) }),
    'CHECK_FAILED',
  );
  assert.equal((await inspectProject(project)).outcomes.checks, 'failed');
  const checked = await checkProject(project, {
    runner: async (request) => {
      assert.deepEqual(request.args, ['run', 'typecheck']);
      return { exitCode: 0 };
    },
  });
  assert.equal(checked.outcomes.checks, 'completed');
  await rm(path.join(project, 'node_modules/fixture-dep/package.json'));
  assert.equal((await inspectProject(project)).outcomes.install, 'failed');
  const noOp = await planAdd({
    projectDir: project,
    selections: {},
    catalog: catalog(),
  });
  assert.equal((await applyPlan(noOp)).outcomes.install, 'failed');
});

test('exclusive lock rejects overlapping operations and live-owner abandonment', async (t) => {
  const { project } = await init(t);
  const plan = await planAdd({
    projectDir: project,
    selections: {},
    catalog: catalog(),
  });
  let unblock!: () => void;
  let signal!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const running = installProject(project, {
    runner: async () => {
      signal();
      await gate;
      return { exitCode: 1 };
    },
  });
  const observed = running.catch((error: unknown) => error);
  await started;
  await rejectsCode(() => applyPlan(plan), 'PROJECT_BUSY');
  await rejectsCode(
    () => recoverOperation(project, { abandonLock: true }),
    'PROJECT_BUSY',
  );
  unblock();
  assert.ok((await observed) instanceof EngineError);
});

test('explicit release-edge upgrade preserves custom source and manual work; unknown gaps refuse', async (t) => {
  const { project } = await init(t);
  await writeFile(
    path.join(project, 'src/app.custom.module.ts'),
    '// upgraded custom source\n',
  );
  const upgrade = await planUpgrade({
    projectDir: project,
    catalog: catalog('0.2.0'),
    upgrades: [
      {
        recipe: 'foundation.nest',
        from: '0.1.0',
        to: '0.2.0',
        migrationId: 'foundation-patch',
      },
    ],
  });
  assert.ok(
    upgrade.changes.some(
      ({ path }) => path === 'src/generated/vcli-app.module.ts',
    ),
  );
  await applyPlan(upgrade);
  assert.equal(
    await readFile(path.join(project, 'src/app.custom.module.ts'), 'utf8'),
    '// upgraded custom source\n',
  );
  const lock = JSON.parse(
    await readFile(path.join(project, 'vcli.lock.json'), 'utf8'),
  );
  assert.ok(lock.migrations.includes('foundation-patch'));
  assert.deepEqual(
    (
      await planUpgrade({
        projectDir: project,
        catalog: catalog('0.2.0'),
        upgrades: [
          {
            recipe: 'foundation.nest',
            from: '0.1.0',
            to: '0.2.0',
            migrationId: 'foundation-patch',
          },
        ],
      })
    ).changes,
    [],
  );
  await rejectsCode(
    () => planUpgrade({ projectDir: project, catalog: catalog('1.0.0') }),
    'STATE_DRIFT',
  );
});

test('post-plan edit of unrelated developer source does not invalidate scoped preconditions', async (t) => {
  const { project } = await init(t);
  const plan = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  await writeFile(
    path.join(project, 'src/app.custom.module.ts'),
    'ordinary editor change\n',
  );
  await writeFile(
    path.join(project, '.env.production'),
    'PRIVATE_SENTINEL_07b=secret',
  );
  await applyPlan(plan);
  assert.equal(
    await readFile(path.join(project, 'src/app.custom.module.ts'), 'utf8'),
    'ordinary editor change\n',
  );
  assert.ok(
    !JSON.stringify(await inspectProject(project)).includes(
      'PRIVATE_SENTINEL_07b',
    ),
  );
});

test('forged hash with unsafe journal paths is rejected before restoration effects', async (t) => {
  const { project } = await init(t);
  const plan = await planScaffold({
    projectDir: project,
    files: [
      { path: 'new-scaffold.ts', content: 'after', ownership: 'scaffold' },
    ],
  });
  await rejectsCode(
    () => applyPlan(plan, { failAfterWrites: 1 }),
    'SOURCE_FAILED',
  );
  const file = path.join(project, '.vcli/local/operations', `${plan.id}.json`);
  const journal = JSON.parse(await readFile(file, 'utf8'));
  journal.entries[0].path = '../outside';
  journal.entries[0].afterHash = createHash('sha256')
    .update('after')
    .digest('hex');
  await writeFile(file, JSON.stringify(journal));
  await rejectsCode(() => recoverOperation(project), 'UNSAFE_PATH');
  assert.equal(
    await readFile(path.join(project, 'new-scaffold.ts'), 'utf8'),
    'after',
  );
});

test('duplicate JSON family keys cannot hide earlier desired selections', async (t) => {
  const { project } = await init(t);
  await writeFile(
    path.join(project, 'vcli.json'),
    '{"schemaVersion":1,"project":{"name":"test-api","packageManager":"npm"},"capabilities":{"foundation":{"recipe":"unknown","options":{}},"foundation":{"recipe":"foundation.nest","options":{}}}}',
  );
  await rejectsCode(
    () => planAdd({ projectDir: project, selections: {}, catalog: catalog() }),
    'INVALID_STATE',
  );
});

test('installation detects missing transitive manifests, and execution protects selected registration', async (t) => {
  const { project } = await init(t);
  await installProject(project, {
    runner: async () => {
      await fakeInstallation(project);
      return { exitCode: 0 };
    },
  });
  const packageLockPath = path.join(project, 'package-lock.json');
  const packageLock = JSON.parse(await readFile(packageLockPath, 'utf8'));
  packageLock.packages['node_modules/transitive-dep'] = {
    version: '1.0.0',
    integrity: 'sha512-transitive',
  };
  await writeFile(packageLockPath, JSON.stringify(packageLock));
  assert.equal((await inspectProject(project)).outcomes.install, 'failed');
  await writeFile(
    path.join(project, 'src/generated/vcli-app.module.ts'),
    '// removed selected registration\n',
  );
  await rejectsCode(
    () => installProject(project, { runner: async () => ({ exitCode: 0 }) }),
    'MANAGED_CONFLICT',
  );
});

test('explicit dead-owner abandonment recovers an interrupted source operation', async (t) => {
  const { project } = await init(t);
  const scaffold = await planScaffold({
    projectDir: project,
    files: [
      { path: 'new-file.ts', content: '// new\n', ownership: 'scaffold' },
    ],
  });
  await rejectsCode(
    () => applyPlan(scaffold, { failAfterWrites: 0 }),
    'SOURCE_FAILED',
  );
  const key = createHash('sha256').update(project).digest('hex').slice(0, 24);
  const lockPath = path.join(
    path.dirname(project),
    `.vcli-${key}.operation.lock`,
  );
  await writeFile(
    lockPath,
    JSON.stringify({
      pid: 2147483647,
      host: os.hostname(),
      nonce: 'dead-owner-fixture',
    }),
  );
  await rejectsCode(() => recoverOperation(project), 'PROJECT_BUSY');
  const recovered = await recoverOperation(project, { abandonLock: true });
  assert.equal(recovered.status, 'recovered');
  await assert.rejects(stat(lockPath));
});

test('forged managed postimage and existing-scaffold adoption are refused', async (t) => {
  const { project } = await init(t);
  const add = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  const registration = add.changes.find(
    ({ path }) => path === 'src/generated/vcli-app.module.ts',
  )!;
  registration.content = '// forged inconsistent registration';
  registration.hash = createHash('sha256')
    .update(registration.content)
    .digest('hex');
  await rejectsCode(() => validatePlan(add), 'INVALID_PLAN');
  const scaffold = await planScaffold({
    projectDir: project,
    files: [
      { path: 'new-file.ts', content: '// new\n', ownership: 'scaffold' },
    ],
  });
  const file = scaffold.changes.find(({ path }) => path === 'new-file.ts')!;
  const original = await readFile(
    path.join(project, 'src/app.custom.module.ts'),
    'utf8',
  );
  file.path = 'src/app.custom.module.ts';
  file.expected = {
    kind: 'hash',
    hash: createHash('sha256').update(original).digest('hex'),
  };
  file.ownership = 'managed';
  const lockChange = scaffold.changes.find(
    ({ path }) => path === 'vcli.lock.json',
  )!;
  const lock = JSON.parse(lockChange.content);
  lock.files['src/app.custom.module.ts'] = {
    ownership: 'managed',
    hash: file.hash,
  };
  lockChange.content = `${JSON.stringify(lock, null, 2)}\n`;
  lockChange.hash = createHash('sha256')
    .update(lockChange.content)
    .digest('hex');
  await rejectsCode(() => applyPlan(scaffold), 'MANAGED_CONFLICT');
  assert.equal(
    await readFile(path.join(project, 'src/app.custom.module.ts'), 'utf8'),
    original,
  );
});

test('interrupted init remains inspectable and recoverable before either metadata file exists', async (t) => {
  const root = await workspace(t);
  const project = path.join(root, 'sample');
  const plan = await planInit({
    workspaceDir: root,
    projectDir: project,
    config: baseConfig(),
    catalog: catalog(),
  });
  await rejectsCode(
    () => applyPlan(plan, { failAfterWrites: 1 }),
    'SOURCE_FAILED',
  );
  const state = await inspectProject(project);
  assert.equal(state.outcomes.source, 'failed');
  assert.equal(state.issues[0]?.code, 'INCOMPLETE_OPERATION');
  assert.equal((await recoverOperation(project)).status, 'recovered');
  assert.equal(
    await stat(path.join(project, '.vcli/local/operations')).then(() => true),
    true,
  );
});

test('explicit recovery refuses obsolete completed operations before changing newer project bytes', async (t) => {
  const { project, plan: original } = await init(t);
  const add = await planAdd({
    projectDir: project,
    selections: { mail: { recipe: 'mail.capture', options: {} } },
    catalog: catalog(),
  });
  await applyPlan(add);
  const latest = await readFile(path.join(project, 'vcli.lock.json'), 'utf8');
  await rejectsCode(
    () => recoverOperation(project, { operationId: original.id }),
    'RECOVERY_CONFLICT',
  );
  assert.equal(
    await readFile(path.join(project, 'vcli.lock.json'), 'utf8'),
    latest,
  );
  assert.equal((await inspectProject(project)).outcomes.source, 'completed');
});

test('real npm script stdout/stderr sentinels are excluded by the argument-vector process boundary', async (t) => {
  const root = await workspace(t);
  const sentinel = 'ENV_PROCESS_SENTINEL_e5017';
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      scripts: {
        emit: 'node -e "console.log(process.env.VCLI_TEST_SENTINEL);console.error(process.env.VCLI_TEST_SENTINEL);process.exit(7)"',
      },
    }),
  );
  const environment = { ...process.env, VCLI_TEST_SENTINEL: sentinel };
  const positive = spawnSync('npm', ['run', 'emit'], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
  });
  assert.equal(positive.status, 7);
  assert.ok(positive.stdout.includes(sentinel));
  assert.ok(positive.stderr.includes(sentinel));
  const moduleUrl = new URL('../dist/engine/index.js', import.meta.url).href;
  const code = `const {spawnCommand}=await import(${JSON.stringify(moduleUrl)});const result=await spawnCommand({command:'npm',args:['run','emit'],cwd:process.cwd()});process.stdout.write(JSON.stringify(result));`;
  const protectedRun = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', code],
    { cwd: root, env: environment, encoding: 'utf8' },
  );
  assert.equal(protectedRun.status, 0);
  assert.deepEqual(JSON.parse(protectedRun.stdout), { exitCode: 7 });
  assert.ok(!protectedRun.stdout.includes(sentinel));
  assert.ok(!protectedRun.stderr.includes(sentinel));
});

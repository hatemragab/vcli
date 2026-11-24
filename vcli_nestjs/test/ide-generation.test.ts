import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { withLocalDistribution } from '../dist/distribution.js';
import { applyPlan, planInit } from '../dist/engine/index.js';
import { recipeCatalog } from '../dist/recipes/index.js';

const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));
const targets = {
  install:
    /npm --prefix tools\/vcli install\b[\s\S]*node tools\/vcli\/bin\/vcli\.mjs install\b/u,
  dev: /npm exec -- vcli dev --environment "development" --port "3100" --config-file "\.env\.development"/u,
  build: /^\s*npm run build\s*$/u,
  start: /^\s*APP_ENV_FILE="\.env\.development" npm start\s*$/u,
  check: /^\s*npm run check\s*$/u,
  test: /^\s*npm test\s*$/u,
};
const tasksPath = '.vscode/tasks.json';
const runConfiguration = (target: string) => `.run/vcli-${target}.run.xml`;
const label = (target: string) =>
  `VCLI: ${target[0]!.toUpperCase()}${target.slice(1)}`;
const idePaths = [tasksPath, ...Object.keys(targets).map(runConfiguration)];

function cli(cwd: string, args: string[]): string {
  const child = spawnSync(
    process.execPath,
    [executable, ...args, '--skip-install'],
    {
      cwd,
      encoding: 'utf8',
      timeout: 45_000,
    },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return child.stdout;
}

async function ownedFiles(project: string) {
  const lock = JSON.parse(
    await readFile(join(project, 'vcli.lock.json'), 'utf8'),
  ) as {
    files: Record<string, { ownership: string }>;
  };
  return lock.files;
}

test('generated IDE launchers delegate to the six project Make targets and remain developer-owned', async (t) => {
  const workspace = await mkdtemp(join(await realpath(tmpdir()), 'vcli-ide-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const project = join(workspace, 'api');
  cli(workspace, ['init', 'api', '--yes']);

  const vscode = JSON.parse(
    await readFile(join(project, tasksPath), 'utf8'),
  ) as {
    version: string;
    tasks: {
      label: string;
      type: string;
      command: string;
      args: string[];
      options: { cwd: string };
    }[];
  };
  assert.equal(vscode.version, '2.0.0');
  const files = await ownedFiles(project);
  for (const path of idePaths) assert.equal(files[path]?.ownership, 'scaffold');
  assert.equal(vscode.tasks.length, Object.keys(targets).length);
  const makeOptions = {
    cwd: project,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, LC_ALL: 'C' },
    timeout: 5_000,
  } as const;
  const makeVersion = spawnSync('make', ['--version'], makeOptions);
  const hasGnuMake =
    makeVersion.status === 0 && makeVersion.stdout.includes('GNU Make');
  if (!hasGnuMake)
    t.diagnostic(
      'GNU Make unavailable. Checked generated launchers without Make dry runs.',
    );
  for (const [target, expectedCommand] of Object.entries(targets)) {
    const task = vscode.tasks.find((item) => item.label === label(target));
    assert.ok(task, `Missing VS Code task for ${target}`);
    assert.equal(task.type, 'process');
    assert.equal(task.command, 'make');
    assert.deepEqual(task.args, [target]);
    assert.deepEqual(task.options, { cwd: '${workspaceFolder}' });
    assert.equal(Object.hasOwn(task, 'runOptions'), false);

    const jetbrains = await readFile(
      join(project, runConfiguration(target)),
      'utf8',
    );
    assert.match(
      jetbrains,
      /^<component name="ProjectRunConfigurationManager">/u,
    );
    assert.ok(jetbrains.includes(`name="${task.label}"`));
    assert.match(jetbrains, /type="MAKEFILE_TARGET_RUN_CONFIGURATION"/u);
    assert.match(jetbrains, /factoryName="Makefile"/u);
    assert.match(jetbrains, /filename="\$PROJECT_DIR\$\/Makefile"/u);
    assert.ok(jetbrains.includes(`target="${target}"`));
    assert.match(jetbrains, /workingDirectory="\$PROJECT_DIR\$"/u);
    assert.match(jetbrains, /<method v="2"\s*\/>/u);

    if (hasGnuMake) {
      const make = spawnSync(task.command, ['-n', ...task.args], makeOptions);
      assert.ifError(make.error);
      assert.equal(make.status, 0, make.stderr);
      assert.match(make.stdout, expectedCommand);
    }
  }

  const edited = {
    [tasksPath]: JSON.stringify({
      version: '2.0.0',
      tasks: [{ label: 'My project task' }],
    }),
    [runConfiguration('dev')]:
      '<component name="ProjectRunConfigurationManager"><!-- developer edit --></component>\n',
  };
  for (const [path, content] of Object.entries(edited))
    await writeFile(join(project, path), content);
  cli(project, ['upgrade']);
  const upgraded = await ownedFiles(project);
  for (const [path, content] of Object.entries(edited)) {
    assert.equal(await readFile(join(project, path), 'utf8'), content);
    assert.equal(upgraded[path]?.ownership, 'scaffold');
  }
});

test('same-version upgrade adds missing IDE configs and skips existing unowned configs', async (t) => {
  const workspace = await mkdtemp(
    join(await realpath(tmpdir()), 'vcli-ide-upgrade-'),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const project = join(workspace, 'api');
  await applyPlan(
    await planInit({
      workspaceDir: workspace,
      projectDir: project,
      config: {
        schemaVersion: 1,
        project: { name: 'api', packageManager: 'npm' },
        capabilities: {
          foundation: { recipe: 'foundation.nest', options: {} },
        },
      },
      catalog: withLocalDistribution({
        ...recipeCatalog,
        async render(config, recipes) {
          const result = await recipeCatalog.render(config, recipes);
          return {
            ...result,
            files: result.files.filter((file) => !idePaths.includes(file.path)),
          };
        },
      }),
    }),
  );
  await mkdir(join(project, '.vscode'));
  await mkdir(join(project, '.run'));
  const existing = {
    [tasksPath]: '{"version":"2.0.0","tasks":[]}\n',
    [runConfiguration('dev')]:
      '<component name="ProjectRunConfigurationManager"><!-- pre-existing config --></component>\n',
    '.run/custom.run.xml':
      '<component name="ProjectRunConfigurationManager"><!-- other config --></component>\n',
  };
  for (const [path, content] of Object.entries(existing))
    await writeFile(join(project, path), content);

  const preview = cli(project, ['upgrade', '--dry-run']);
  assert.ok(preview.includes(`Preserved existing ${tasksPath}.`), preview);
  assert.ok(
    preview.includes(`Preserved existing ${runConfiguration('dev')}.`),
    preview,
  );
  await assert.rejects(
    readFile(join(project, runConfiguration('start')), 'utf8'),
    { code: 'ENOENT' },
  );
  cli(project, ['upgrade']);
  const files = await ownedFiles(project);
  for (const [path, content] of Object.entries(existing)) {
    assert.equal(await readFile(join(project, path), 'utf8'), content);
    assert.equal(files[path], undefined);
  }
  for (const path of idePaths.filter(
    (path) => !Object.hasOwn(existing, path),
  )) {
    assert.equal(files[path]?.ownership, 'scaffold');
    assert.match(
      await readFile(join(project, path), 'utf8'),
      /MAKEFILE_TARGET_RUN_CONFIGURATION/u,
    );
  }
});

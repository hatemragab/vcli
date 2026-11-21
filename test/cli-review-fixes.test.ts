import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  BoundedFailure,
  CONFIG_ERROR_CODES,
  describeThrown,
  publicDetails,
  type ProjectConfig,
} from '../dist/contracts.js';
import { publicError } from '../dist/commands/command-output.js';
import { formatTextData } from '../dist/commands/text-formatters.js';
import { applyPlan, planInit, recoverOperation } from '../dist/engine/index.js';
import { recipeCatalog } from '../dist/recipes/index.js';
import { describeServices } from '../dist/recipes/service-plan.js';
import {
  replaceExact,
  removeBetween,
} from '../dist/recipes/template-markers.js';
import { parseCheckDiagnostics } from '../dist/script-result.js';

const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

test('username local auth with push and no mail declares ApplicationDependencies in create-app.ts', async () => {
  const config: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'push-username-api', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: 'database.mongodb', options: {} },
      auth: { recipe: 'auth.local', options: { identifier: 'username' } },
      'push-fcm': { recipe: 'push.fcm', options: {} },
    },
  };
  const resolved = Object.values(config.capabilities).map((selected) =>
    recipeCatalog.recipes.find((r) => r.id === selected.recipe)!,
  );
  const rendered = await recipeCatalog.render(config, resolved);
  const createApp = rendered.files.find(
    (item) => item.path === 'src/create-app.ts',
  );
  assert.ok(createApp);
  assert.match(createApp.content, /export type ApplicationDependencies/);
  assert.match(
    createApp.content,
    /dependencies:\s*ApplicationDependencies\s*=\s*\{\}/,
  );
  assert.match(
    createApp.content,
    /createPushRuntime\([\s\S]*dependencies\.push/,
  );
});

test('ESLint stylish output with absolute paths extracts relative path, line, column and scoped rule code', () => {
  const cwd = '/workspace/sample-api';
  const raw = [
    '',
    '/workspace/sample-api/src/modules/notes/notes.service.ts',
    '  14:9  error  Unexpected any SECRET_TOKEN_VALUE  @typescript-eslint/no-explicit-any',
    '  28:3  error  Unused var SECRET_TOKEN_VALUE      no-unused-vars',
    '',
    '/outside/other/file.ts',
    '  1:1  error  Should be ignored  no-undef',
  ].join('\n');
  const diagnostics = parseCheckDiagnostics(raw, cwd);
  assert.deepEqual(diagnostics, [
    {
      path: 'src/modules/notes/notes.service.ts',
      line: 14,
      column: 9,
      code: '@typescript-eslint/no-explicit-any',
    },
    {
      path: 'src/modules/notes/notes.service.ts',
      line: 28,
      column: 3,
      code: 'no-unused-vars',
    },
  ]);
  assert.equal(
    JSON.stringify(diagnostics).includes('SECRET_TOKEN_VALUE'),
    false,
  );
  const published = publicDetails({ diagnostics });
  assert.deepEqual(published.diagnostics, diagnostics);
});

test('CONFIG_ERROR_CODES covers every ApplicationError code emitted by config renderers', async () => {
  const files = [
    'src/recipes/render-config.ts',
    'src/recipes/config-core-contributions.ts',
    'src/recipes/config-feature-contributions.ts',
    'src/recipes/config-snippets.ts',
  ];
  const allowed = new Set<string>(CONFIG_ERROR_CODES);
  for (const file of files) {
    const content = await readFile(join(workspaceRoot, file), 'utf8');
    for (const match of content.matchAll(
      /new ApplicationError\('([A-Z0-9_]+)',\s*500/g,
    )) {
      assert.ok(
        allowed.has(match[1]!),
        `${file} throws ${match[1]!} which is missing from CONFIG_ERROR_CODES`,
      );
    }
  }
});

test('client dependency errors and BoundedFailure keep exact codes without collapsing to COMMAND_FAILED', () => {
  const clientFailure = describeThrown(
    new Error('UNPINNED_CLIENT_DEPENDENCY:some-pkg'),
  );
  assert.equal(clientFailure?.code, 'INVALID_CATALOG');
  assert.equal(clientFailure?.details.origin, 'distribution');
  assert.equal(clientFailure?.details.option, 'some-pkg');

  const config: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'cluster-api', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: 'database.mongodb', options: {} },
      storage: { recipe: 'storage.local', options: {} },
    },
  };
  let caught: unknown;
  try {
    describeServices(config, [], { topology: 'cluster', replicas: 2 });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof BoundedFailure);
  const mapped = publicError(caught);
  assert.equal(mapped.code, 'UNSUPPORTED_SERVICE_TOPOLOGY');
  assert.notEqual(mapped.code, 'COMMAND_FAILED');
});

test('default and verbose text output render catalog, explain, doctor, logs and upgrade summaries', () => {
  const catalogRun = spawnSync(process.execPath, [executable, 'catalog'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
  });
  assert.equal(catalogRun.status, 0);
  assert.match(catalogRun.stdout, /foundation\.nest/);
  assert.match(catalogRun.stdout, /database\.mongodb/);

  const catalogVerbose = spawnSync(
    process.execPath,
    [executable, '--verbose', 'catalog'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
    },
  );
  assert.equal(catalogVerbose.status, 0);
  assert.match(catalogVerbose.stdout, /"examples"/);

  const explainLines = formatTextData('explain', {
    path: 'src/modules/notes/notes.service.ts',
    owner: 'scaffold',
    renderer: 'example.notes',
    template: 'mongodb/src/modules/notes/notes.service.ts',
    provenance: 'project-lock',
    check: 'npm test',
  });
  assert.ok(explainLines.some((line) => line.includes('owner: scaffold')));
  assert.ok(
    explainLines.some((line) => line.includes('renderer: example.notes')),
  );

  const doctorLines = formatTextData('doctor', {
    outcomes: { source: 'completed', install: 'pending', checks: 'pending' },
    issues: [
      {
        code: 'INSTALL_INCOMPLETE',
        action: 'Run vcli install.',
      },
    ],
    configValidation: { status: 'not-run', next: 'vcli config check' },
  });
  assert.ok(doctorLines.some((line) => line.includes('INSTALL_INCOMPLETE')));
  assert.ok(doctorLines.some((line) => line.includes('vcli config check')));

  const logLines = formatTextData('logs.query', {
    retainedFiles: 2,
    retainedBytes: 1024,
    sources: ['application'],
    gaps: ['none'],
    truncated: false,
    events: [
      {
        timestamp: '2026-11-19T12:00:00.000Z',
        severity: 'error',
        event: 'http.failed',
        route: '/api/notes',
        errorCode: 'NOTE_NOT_FOUND',
      },
    ],
  });
  assert.ok(logLines.some((line) => line.includes('retained: 2 files')));
  assert.ok(logLines.some((line) => line.includes('NOTE_NOT_FOUND')));
});

test('vector config without database allows no database events and logs status reports missing diagnostics', async () => {
  const config: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'nodb-diag-api', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      diagnostics: {
        recipe: 'diagnostics.local',
        options: { vector: true, sources: ['application'] },
      },
    },
  };
  const resolved = Object.values(config.capabilities).map((selected) =>
    recipeCatalog.recipes.find((r) => r.id === selected.recipe)!,
  );
  const rendered = await recipeCatalog.render(config, resolved);
  const vector = rendered.files.find(
    (item) => item.path === 'ops/diagnostics/vector.yaml',
  );
  assert.ok(vector);
  assert.match(vector.content, /includes\(\[\], \.database\)/);

  const dir = await mkdtemp(join(tmpdir(), 'vcli-logs-nodiag-'));
  try {
    const init = spawnSync(
      process.execPath,
      [executable, 'init', 'app', '--yes', '--skip-install', '--json'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(init.status, 0);
    const logs = spawnSync(
      process.execPath,
      [executable, '--project', join(dir, 'app'), 'logs', 'status', '--json'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(logs.status, 1);
    const parsed = JSON.parse(logs.stdout) as {
      data: { code: string; next: string };
    };
    assert.equal(parsed.data.code, 'DIAGNOSTICS_NOT_SELECTED');
    assert.equal(parsed.data.next, 'vcli add diagnostics.local');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyPlan and recoverOperation clean up .vcli/local/stages/<id> directories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vcli-stage-cleanup-'));
  try {
    const project = join(dir, 'app');
    const plan = await planInit({
      workspaceDir: dir,
      projectDir: project,
      config: {
        schemaVersion: 1,
        project: { name: 'stage-api', packageManager: 'npm' },
        capabilities: {
          foundation: { recipe: 'foundation.nest', options: {} },
        },
      },
      catalog: recipeCatalog,
    });
    const result = await applyPlan(plan);
    await assert.rejects(
      stat(join(project, '.vcli/local/stages', result.operationId)),
      { code: 'ENOENT' },
    );

    const failProject = join(dir, 'failed-app');
    const failPlan = await planInit({
      workspaceDir: dir,
      projectDir: failProject,
      config: {
        schemaVersion: 1,
        project: { name: 'stage-fail-api', packageManager: 'npm' },
        capabilities: {
          foundation: { recipe: 'foundation.nest', options: {} },
        },
      },
      catalog: recipeCatalog,
    });
    await assert.rejects(() => applyPlan(failPlan, { failAfterWrites: 1 }));
    const recovered = await recoverOperation(failProject);
    assert.equal(recovered.status, 'recovered');
    await assert.rejects(
      stat(join(failProject, '.vcli/local/stages', failPlan.id)),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('template marker helpers fail with distribution INVALID_CATALOG when markers are missing', () => {
  assert.throws(
    () => replaceExact('hello world', 'missing', 'x', 'template.ts'),
    (error: unknown) =>
      error instanceof BoundedFailure &&
      error.code === 'INVALID_CATALOG' &&
      error.details.origin === 'distribution',
  );
  assert.throws(
    () => removeBetween('hello world', 'start', 'end', 'template.ts'),
    (error: unknown) =>
      error instanceof BoundedFailure &&
      error.code === 'INVALID_CATALOG' &&
      error.details.origin === 'distribution',
  );
});

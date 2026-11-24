import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { RecipeCatalog, ProjectConfig } from '../src/contracts.ts';
import {
  maintenanceFixture,
  maintenanceModule,
  prepareMaintenanceFixture,
} from './maintenance-fixture.ts';
before(prepareMaintenanceFixture);
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const codePath = 'tools/vcli/dist/engine/managed-content.d.ts';
const code = (revision: number) =>
  `export const REGION_START = '<!-- vcli:managed:start -->';\nexport const REGION_END = '<!-- vcli:managed:end -->';\nexport const revision = ${revision};\n`;
const config: ProjectConfig = {
  schemaVersion: 1,
  project: { name: 'ownership-fixture', packageManager: 'npm' },
  capabilities: { foundation: { recipe: 'foundation.nest', options: {} } },
};
function catalog(revision: number): RecipeCatalog {
  return {
    recipes: [
      {
        id: 'foundation.nest',
        family: 'foundation',
        version: '0.1.1',
        requires: [],
        conflicts: [],
        validateOptions: () => ({}),
      },
    ],
    render: async () => ({
      files: [
        {
          path: 'package.json',
          content: '{"name":"ownership-fixture","private":true}\n',
          ownership: 'managed',
        },
        { path: codePath, content: code(revision), ownership: 'managed' },
        {
          path: 'README.md',
          content: `# App\n<!-- vcli:managed:start -->\nRevision ${revision}\n<!-- vcli:managed:end -->\nDeveloper notes\n`,
          ownership: 'managed',
        },
        {
          path: 'templates/README.md',
          content: `<!-- vcli:managed:start -->\nVendor revision ${revision}\n<!-- vcli:managed:end -->\nOwned vendor suffix\n`,
          ownership: 'managed',
        },
      ],
      checks: [],
      warnings: [],
      pending: [],
    }),
  };
}
test('marker strings in managed code/vendor Markdown retain full ownership; root README prose is preserved', async (t) => {
  const e =
    await maintenanceModule<typeof import('../src/engine/index.ts')>(
      'engine/index',
    );
  const root = await mkdtemp(join(maintenanceFixture, 'ownership-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'app');
  await e.applyPlan(
    await e.planInit({
      workspaceDir: root,
      projectDir: project,
      config,
      catalog: catalog(1),
    }),
  );
  const lock = JSON.parse(
    await readFile(join(project, 'vcli.lock.json'), 'utf8'),
  );
  assert.equal(lock.files[codePath].region, undefined);
  assert.equal(lock.files[codePath].hash, digest(code(1)));
  assert.equal(lock.files['templates/README.md'].region, undefined);
  assert.equal(lock.files['README.md'].region, true);
  const readme = join(project, 'README.md');
  await writeFile(
    readme,
    (await readFile(readme, 'utf8')).replace(
      'Developer notes',
      'Private developer prose stays',
    ),
  );
  const next = await e.planUpgrade({
    projectDir: project,
    catalog: catalog(2),
  });
  assert.ok(next.changes.some((change) => change.path === codePath));
  await e.applyPlan(next);
  assert.equal(await readFile(join(project, codePath), 'utf8'), code(2));
  assert.ok(
    (await readFile(readme, 'utf8')).includes('Private developer prose stays'),
  );
  await writeFile(
    join(project, codePath),
    code(2) + '// later edit outside marker literals\n',
  );
  await assert.rejects(
    e.planUpgrade({ projectDir: project, catalog: catalog(3) }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'MANAGED_CONFLICT',
  );
});
test('legacy or forged non-document region provenance refuses before filesystem effects', async (t) => {
  const e =
    await maintenanceModule<typeof import('../src/engine/index.ts')>(
      'engine/index',
    );
  const root = await mkdtemp(join(maintenanceFixture, 'ownership-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'app');
  const plan = await e.planInit({
    workspaceDir: root,
    projectDir: project,
    config,
    catalog: catalog(1),
  });
  const lockChange = plan.changes.find(
    (change) => change.path === 'vcli.lock.json',
  )!;
  const lock = JSON.parse(lockChange.content);
  lock.files[codePath].region = true;
  lockChange.content = JSON.stringify(lock, null, 2) + '\n';
  lockChange.hash = digest(lockChange.content);
  await assert.rejects(
    e.applyPlan(plan),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INVALID_STATE',
  );
  await assert.rejects(readFile(join(project, 'vcli.lock.json')));
});

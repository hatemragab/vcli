import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import type { ProjectConfig } from '../src/contracts.js';
import { recipeCatalog } from '../dist/recipes/index.js';

test('emitted architecture gate rejects type cycles, extra classes and hidden-loading shortcuts', async () => {
  const config: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'gate-fixture', packageManager: 'npm' },
    capabilities: { foundation: { recipe: 'foundation.nest', options: {} } },
  };
  const project = await recipeCatalog.render(
    config,
    recipeCatalog.recipes.filter((r) => r.family === 'foundation'),
  );
  const directory = await mkdtemp(join(tmpdir(), 'vcli-recipe-gate-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await symlink(
      resolve('node_modules'),
      join(directory, 'node_modules'),
      'dir',
    );
    for (const file of project.files.filter((f) =>
      f.path.startsWith('scripts/'),
    )) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    const checker: {
      checkArchitecture(path: string): Promise<{ failures: string[] }>;
    } = await import(
      pathToFileURL(join(directory, 'scripts/architecture-rules.ts')).href
    );
    const source = join(directory, 'src');
    await mkdir(source);
    await writeFile(join(source, 'good.ts'), 'export class Good {}');
    assert.deepEqual((await checker.checkArchitecture(source)).failures, []);
    await writeFile(
      join(source, 'a.ts'),
      "import type {B} from './b.js';export type A={value:B};",
    );
    await writeFile(
      join(source, 'b.ts'),
      "import type {A} from './a.js';export type B={value:A};",
    );
    await writeFile(
      join(source, 'extra.ts'),
      'export class First {}\nexport class Second {}',
    );
    await writeFile(
      join(source, 'shortcut.ts'),
      "import {forwardRef as concealed} from 'node:module';void concealed;import('node:fs');",
    );
    const failed = await checker.checkArchitecture(source);
    assert.ok(failed.failures.some((f) => f.includes('File import cycle')));
    assert.ok(failed.failures.some((f) => f.includes('2 handwritten classes')));
    assert.ok(failed.failures.some((f) => f.includes('forwardRef')));
    assert.ok(
      failed.failures.some((f) => f.includes('dynamic dependency loading')),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('foundation emitted database gate rejects DB source and alias/locked closure drift', async () => {
  const config: ProjectConfig = {
    schemaVersion: 1,
    project: { name: 'isolation-fixture', packageManager: 'npm' },
    capabilities: { foundation: { recipe: 'foundation.nest', options: {} } },
  };
  const project = await recipeCatalog.render(
    config,
    recipeCatalog.recipes.filter((r) => r.family === 'foundation'),
  );
  const directory = await mkdtemp(join(tmpdir(), 'vcli-recipe-isolation-'));
  try {
    await symlink(
      resolve('node_modules'),
      join(directory, 'node_modules'),
      'dir',
    );
    for (const file of project.files.filter((f) =>
      f.path.startsWith('scripts/'),
    )) {
      const path = join(directory, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    // Deliberate synthetic corruption fixture; this is not installation evidence.
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        type: 'module',
        dependencies: { disguised: 'npm:pg@8.23.1' },
      }),
    );
    await writeFile(
      join(directory, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { disguised: 'npm:pg@8.23.1' } },
          'node_modules/disguised': { name: 'pg', version: '8.23.1' },
        },
      }),
    );
    await mkdir(join(directory, 'src'));
    await writeFile(
      join(directory, 'src/postgres-database.ts'),
      'export class PostgresDatabase {}',
    );
    const checker: {
      checkDatabaseIsolation(
        path: string,
      ): Promise<{ database: string; failures: string[] }>;
    } = await import(
      pathToFileURL(join(directory, 'scripts/database-isolation-rules.ts')).href
    );
    const failed = await checker.checkDatabaseIsolation(directory);
    assert.equal(failed.database, 'none');
    assert.ok(failed.failures.some((f) => f.includes('forbidden dependency')));
    assert.ok(
      failed.failures.some((f) => f.includes('forbidden installed package')),
    );
    assert.ok(
      failed.failures.some((f) =>
        f.includes('unselected database source file'),
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

const databaseProfiles = [
  {
    database: 'none',
    requiredPackages: [],
    selectedSource: 'bootstrap.ts',
    oppositePackage: 'pg',
    oppositeSource: 'postgres-database.ts',
  },
  {
    database: 'mongodb',
    requiredPackages: ['mongoose'],
    selectedSource: 'mongo-database.ts',
    oppositePackage: 'pg',
    oppositeSource: 'postgres-database.ts',
  },
  {
    database: 'postgres',
    requiredPackages: ['drizzle-orm', 'pg'],
    selectedSource: 'postgres-database.ts',
    oppositePackage: 'mongoose',
    oppositeSource: 'mongo-database.ts',
  },
] as const;

for (const profile of databaseProfiles) {
  test(`emitted ${profile.database} database gate rejects unselected source and locked aliases`, async () => {
    const config: ProjectConfig = {
      schemaVersion: 1,
      project: { name: 'isolation-fixture', packageManager: 'npm' },
      capabilities: { foundation: { recipe: 'foundation.nest', options: {} } },
    };
    if (profile.database !== 'none')
      config.capabilities.database = {
        recipe: `database.${profile.database}`,
        options: {},
      };
    const project = await recipeCatalog.render(
      config,
      recipeCatalog.recipes.filter(
        (r) => config.capabilities[r.family]?.recipe === r.id,
      ),
    );
    const makefile = project.files.find((file) => file.path === 'Makefile');
    assert.ok(makefile);
    assert.equal(
      makefile.content.includes('first-run: build'),
      profile.database !== 'none',
    );
    if (profile.database !== 'none') {
      assert.match(
        makefile.content,
        /FIRST_RUN_CONFIG_FILE := \$\(or \$\(CONFIG_FILE\),\$\(APP_ENV_FILE\),\$\(wildcard \.env\.development\)\)/,
      );
      assert.match(
        makefile.content,
        /vcli release apply \$\(FIRST_RUN_CONFIG_ARG\)/,
      );
      assert.match(
        makefile.content,
        /\$\(MAKE\) dev ENVIRONMENT=development CONFIG_FILE="\$\(FIRST_RUN_CONFIG_FILE\)"/,
      );
    }
    const directory = await mkdtemp(join(tmpdir(), 'vcli-recipe-isolation-'));
    try {
      await symlink(
        resolve('node_modules'),
        join(directory, 'node_modules'),
        'dir',
      );
      const checkerPath = 'scripts/database-isolation-rules.ts';
      const source = project.files.find((file) => file.path === checkerPath);
      assert.ok(source);
      await mkdir(join(directory, 'scripts'));
      await mkdir(join(directory, 'src'));
      await writeFile(join(directory, checkerPath), source.content);
      await writeFile(
        join(directory, 'src', profile.selectedSource),
        'export const fixture = true;',
      );
      // The checker reads synthetic package metadata without installing SDKs.
      const dependencies = Object.fromEntries(
        profile.requiredPackages.map((name) => [name, '1.0.0']),
      );
      const packages = Object.fromEntries(
        profile.requiredPackages.map((name) => [
          `node_modules/${name}`,
          { name, version: '1.0.0' },
        ]),
      );
      async function writePackageMetadata(): Promise<void> {
        await writeFile(
          join(directory, 'package.json'),
          JSON.stringify({ type: 'module', dependencies }),
        );
        await writeFile(
          join(directory, 'package-lock.json'),
          JSON.stringify({
            lockfileVersion: 3,
            packages: { '': { dependencies }, ...packages },
          }),
        );
      }
      await writePackageMetadata();
      const checker: {
        checkDatabaseIsolation(
          path: string,
        ): Promise<{ database: string; failures: string[] }>;
      } = await import(pathToFileURL(join(directory, checkerPath)).href);
      const passed = await checker.checkDatabaseIsolation(directory);
      assert.equal(passed.database, profile.database);
      assert.deepEqual(passed.failures, []);

      dependencies.disguised = `npm:${profile.oppositePackage}@1.0.0`;
      packages['node_modules/disguised'] = {
        name: profile.oppositePackage,
        version: '1.0.0',
      };
      await writePackageMetadata();
      await writeFile(
        join(directory, 'src', profile.oppositeSource),
        'export const fixture = true;',
      );
      const failed = await checker.checkDatabaseIsolation(directory);
      assert.equal(failed.database, profile.database);
      assert.ok(
        failed.failures.some((f) => f.includes('forbidden dependency')),
      );
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
}

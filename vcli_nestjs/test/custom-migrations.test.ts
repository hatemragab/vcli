import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { recipeCatalog } from '../dist/recipes/index.js';
import { linkGeneratedDependencies } from './generated-dependencies.ts';

for (const database of ['postgres', 'mongodb'] as const) {
  const url =
    process.env[`VCLI_CUSTOM_MIGRATION_${database.toUpperCase()}_TEST_URL`];
  test(
    `generated ${database}: register orders, apply a preserving release, start Nest and validate backup readiness`,
    { skip: !url && 'disposable native database URL not supplied' },
    async () => {
      assert.match(
        new URL(url!).pathname,
        /^\/vcli_custom_migration_[a-z0-9_]+$/,
      );
      const root = await mkdtemp(join(tmpdir(), 'vcli-migration-'));
      try {
        const selected = recipeCatalog.recipes.filter((recipe) =>
          ['foundation.nest', 'database.' + database].includes(recipe.id),
        );
        const generated = await recipeCatalog.render(
          {
            schemaVersion: 1,
            project: { name: 'migration-proof', packageManager: 'npm' },
            capabilities: Object.fromEntries(
              selected.map((recipe) => [
                recipe.family,
                { recipe: recipe.id, options: {} },
              ]),
            ),
          },
          selected,
        );
        for (const file of generated.files) {
          await mkdir(dirname(join(root, file.path)), { recursive: true });
          await writeFile(join(root, file.path), file.content);
        }
        await linkGeneratedDependencies(root);
        const run = (args: string[]) => {
          const result = spawnSync(process.execPath, args, {
            cwd: root,
            env: {
              PATH: process.env.PATH,
              LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
              NODE_ENV: 'test',
              DATABASE_URL: url,
            },
            encoding: 'utf8',
            timeout: 30000,
          });
          assert.equal(
            result.status,
            0,
            (result.stdout + result.stderr).replaceAll(url!, '<test-database>'),
          );
          return result.stdout;
        };
        const build = () =>
          run([resolve('node_modules/typescript/bin/tsc'), '-p', '.']);
        const release = () =>
          JSON.parse(run(['dist/initialize-database.js'])) as {
            releaseId: string;
            owners: string[];
          };
        build();
        const baseline = release();
        const previousId =
          'selected-v1-' +
          createHash('sha256')
            .update(JSON.stringify({ variant: database, components: [] }))
            .digest('hex')
            .slice(0, 24);
        assert.equal(baseline.releaseId, previousId);
        assert.deepEqual(baseline.owners, []);
        const registration = generated.files.find(
          (file) => file.path === 'src/release/custom-migrations.ts',
        )!;
        assert.equal(registration.ownership, 'scaffold');
        const guide = generated.files.find(
          (file) => file.path === 'ops/release/README.md',
        )!;
        const snippet =
          /## Register a feature migration[\s\S]*?```ts\n([\s\S]+?)\n```/.exec(
            guide.content,
          );
        assert.ok(snippet, 'include the selected native migration example');
        const replacement = registration.content.replace(
          /export const customMigrations[\s\S]*$/u,
          snippet[1]!,
        );
        await writeFile(
          join(root, registration.path),
          "import { createHash } from 'node:crypto';\n" + replacement + '\n',
        );
        build();
        const boot = `import assert from 'node:assert/strict';
          import {createApp} from './dist/create-app.js';
          import {loadConfig} from './dist/core/config/load-config.js';
          import {NativeBackup} from './dist/release/native-backup.js';
          import {selectedReleaseManifest} from './dist/generated/selected-release.js';
          const config=loadConfig();
          const checkBackup=()=>new NativeBackup().assertReady(config.database.url,selectedReleaseManifest);`;
        run([
          '--input-type=module',
          '-e',
          boot +
            'await assert.rejects(createApp(config), /SCHEMA_RELEASE_REQUIRED/); await assert.rejects(checkBackup(),/NOT_READY/);',
        ]);
        const activated = release();
        assert.notEqual(activated.releaseId, previousId);
        assert.deepEqual(activated.owners, ['app.orders']);
        assert.deepEqual(release(), activated);
        const schemaCheck =
          database === 'postgres'
            ? "assert.equal((await db.pool.query(\"SELECT to_regclass('orders')::text AS name\")).rows[0].name,'orders');"
            : "assert.ok((await db.connection.collection('orders').indexes()).some(index=>index.key.id===1 && index.unique===true));";
        run([
          '--input-type=module',
          '-e',
          boot +
            `
          import {openDatabase} from './dist/core/database/database.js';
          import {readNativeReleaseLedger} from './dist/release/native-release-store.js';
          const db=await openDatabase(config,false);
          try {
            ${schemaCheck}
            const ledger=await readNativeReleaseLedger(db);
            assert.equal(ledger.attempts.filter(item=>item.component==='app.orders').length,1);
          } finally {await db.close();}
          await checkBackup();
          const runtime=await createApp(config); await runtime.close();`,
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}

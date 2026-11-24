import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  checkDatabaseIsolation,
  selectedDatabase,
} from '../scripts/database-isolation-rules.ts';

const nativeDependencies = { 'drizzle-orm': '1.0.0', pg: '1.0.0' };
const oppositeDependencies = ['mongoose', 'mongodb', '@types/mongodb'];
const oppositeClosure = ['bson', 'kareem', 'mquery', '@mongodb-js/saslprep'];
const oppositeSdk = 'mongoose';
const oppositeFile = 'mongo-database';
const oppositeClass = 'MongoDatabase';
const sharedUtility = 'ms';
const nativeSource =
  "import type { PoolClient } from 'pg'; import type { SQL } from 'drizzle-orm'; export type NativeSession = { client: PoolClient; query: SQL };";

type FixtureOptions = Readonly<{
  files?: Readonly<Record<string, string>>;
  manifest?: Readonly<Record<string, unknown>>;
  packages?: Readonly<Record<string, unknown>>;
  lock?: Readonly<Record<string, unknown>>;
}>;

async function fixture(options: FixtureOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-database-isolation-'));
  const manifest = {
    type: 'module',
    dependencies: nativeDependencies,
    ...options.manifest,
  };
  const packages = {
    '': { dependencies: nativeDependencies },
    ...Object.fromEntries(
      Object.keys(nativeDependencies).map((name) => [
        `node_modules/${name}`,
        { version: '1.0.0' },
      ]),
    ),
    ...options.packages,
  };
  const files = {
    'package.json': JSON.stringify(manifest),
    'package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages,
      ...options.lock,
    }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
      },
      include: ['src/**/*.ts'],
    }),
    'src/core/database/database.ts': nativeSource,
    'src/main.ts':
      "export type { NativeSession } from './core/database/database.js';",
    ...options.files,
  };
  try {
    for (const [name, contents] of Object.entries(files)) {
      const file = join(directory, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, contents);
    }
    return await checkDatabaseIsolation(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function rejects(failures: readonly string[], fragment: string): void {
  assert.ok(
    failures.some((failure) => failure.includes(fragment)),
    `${fragment}\n${failures.join('\n')}`,
  );
}

test('native-only output passes without scanning docs, negative fixtures or contributor node_modules', async () => {
  const result = await fixture({
    files: {
      'src/core/config.ts': `// RepositoryAdapter, DATABASE_DRIVER and ${oppositeClass} are forbidden in output.\nexport type Config = { database: { url: string }; storage: { driver: 'local' | 's3' }; realtime: { driver: 'ws' | 'centrifugo' } };\nexport const selectStorage = (driver: 'local' | 's3') => driver === 'local';\nexport const selectRealtime = (config: Config) => config.realtime.driver === 'ws';`,
      'README.md': `Historical ${oppositeSdk} DATABASE_DRIVER RepositoryAdapter memory database`,
      'test/negative.fixture.ts': `import '${oppositeSdk}'; type Database = 'mongodb' | 'postgres';`,
      [`node_modules/${oppositeSdk}/index.js`]:
        'export const ignoredContributorPackage = true;',
    },
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.database, selectedDatabase);
  assert.equal(result.files, 3);
});

for (const dependency of oppositeDependencies) {
  for (const section of ['dependencies', 'devDependencies']) {
    test(`rejects both database SDK families in manifest ${section}: ${dependency}`, async () => {
      const result = await fixture({
        manifest: {
          [section]: {
            ...(section === 'dependencies' ? nativeDependencies : {}),
            [dependency]: '1.0.0',
          },
        },
      });
      rejects(
        result.failures,
        `package.json: forbidden dependency ${section}.${dependency}`,
      );
    });
  }
  test(`rejects stale lock root and nested installed SDK ${dependency}`, async () => {
    const result = await fixture({
      packages: {
        '': { dependencies: { ...nativeDependencies, [dependency]: '1.0.0' } },
        [`node_modules/stale/node_modules/${dependency}`]: { version: '1.0.0' },
      },
    });
    rejects(result.failures, 'package-lock.json root: forbidden dependency');
    rejects(
      result.failures,
      `forbidden installed package node_modules/stale/node_modules/${dependency}`,
    );
  });
}

for (const name of oppositeClosure) {
  test(`rejects orphan opposite-driver closure entry ${name} after SDK removal`, async () => {
    const result = await fixture({
      packages: { [`node_modules/${name}`]: { version: '1.0.0' } },
    });
    rejects(
      result.failures,
      `forbidden installed package node_modules/${name}`,
    );
  });
}

test('rejects opposite SDK install paths even if lock metadata claims another package', async () => {
  const result = await fixture({
    packages: {
      [`node_modules/${oppositeSdk}`]: {
        name: 'benign-name',
        version: '1.0.0',
      },
    },
  });
  rejects(
    result.failures,
    `forbidden installed package node_modules/${oppositeSdk}`,
  );
});

test('rejects npm aliases in manifests and locks', async () => {
  const result = await fixture({
    manifest: { devDependencies: { hiddenSdk: `npm:${oppositeSdk}@1.0.0` } },
    packages: {
      'node_modules/hiddenSdk': { name: oppositeSdk, version: '1.0.0' },
    },
    files: { 'src/hidden.ts': "export type { Hidden } from 'hiddenSdk';" },
  });
  rejects(result.failures, 'forbidden dependency devDependencies.hiddenSdk');
  rejects(
    result.failures,
    'forbidden installed package node_modules/hiddenSdk',
  );
  rejects(result.failures, 'unselected database SDK import hiddenSdk');
});

test('checks actual locked dependency edges and preserves legitimate shared Firebase utilities', async () => {
  const result = await fixture({
    manifest: {
      dependencies: { ...nativeDependencies, 'firebase-admin': '1.0.0' },
    },
    packages: {
      'node_modules/firebase-admin': {
        dependencies: { 'gcp-metadata': '1.0.0', [sharedUtility]: '1.0.0' },
      },
      'node_modules/gcp-metadata': { version: '1.0.0' },
      [`node_modules/${sharedUtility}`]: { version: '1.0.0' },
    },
  });
  assert.deepEqual(result.failures, []);
});

test('rejects exclusive transitive closure while allowing its shared utility via a legitimate root', async () => {
  const result = await fixture({
    manifest: {
      dependencies: { ...nativeDependencies, 'firebase-admin': '1.0.0' },
    },
    packages: {
      [`node_modules/${oppositeSdk}`]: {
        dependencies: { [sharedUtility]: '1.0.0', 'exclusive-helper': '1.0.0' },
      },
      'node_modules/firebase-admin': {
        dependencies: { [sharedUtility]: '1.0.0' },
      },
      [`node_modules/${sharedUtility}`]: { version: '1.0.0' },
      'node_modules/exclusive-helper': { version: '1.0.0' },
    },
  });
  rejects(
    result.failures,
    'unused opposite-database closure package node_modules/exclusive-helper',
  );
  assert.ok(
    !result.failures.some((failure) =>
      failure.includes(`node_modules/${sharedUtility}`),
    ),
  );
});

test('rejects leftover shared closure packages with no legitimate consumer', async () => {
  const result = await fixture({
    packages: { [`node_modules/${sharedUtility}`]: { version: '1.0.0' } },
  });
  rejects(
    result.failures,
    `unused opposite-database closure package node_modules/${sharedUtility}`,
  );
});

test('does not let an unrelated root launder a forbidden database dependency', async () => {
  const result = await fixture({
    manifest: { dependencies: { ...nativeDependencies, wrapper: '1.0.0' } },
    packages: {
      'node_modules/wrapper': { dependencies: { [oppositeSdk]: '1.0.0' } },
      [`node_modules/wrapper/node_modules/${oppositeSdk}`]: {
        version: '1.0.0',
      },
    },
  });
  rejects(
    result.failures,
    `forbidden installed package node_modules/wrapper/node_modules/${oppositeSdk}`,
  );
});

test('permits fixed database labels and explicit rejection of obsolete env selection', async () => {
  const result = await fixture({
    files: {
      'src/config.ts': `export const config = { database: { driver: '${selectedDatabase}' as const, url: 'native' } }; export const description = config.database.driver; export function reject(env: Record<string, string | undefined>) { if (env.DATABASE_DRIVER !== undefined) throw new Error('unsupported'); if (env['DB_PROVIDER'] !== undefined) { throw new Error('unsupported'); } }`,
    },
  });
  assert.deepEqual(result.failures, []);
});

test('keeps installed peer dependencies shared with a legitimate package', async () => {
  const result = await fixture({
    manifest: { devDependencies: { consumer: '1.0.0' } },
    packages: {
      'node_modules/consumer': {
        peerDependencies: { [sharedUtility]: '1.0.0' },
      },
      [`node_modules/${sharedUtility}`]: { version: '1.0.0' },
    },
  });
  assert.deepEqual(result.failures, []);
});

test('requires the selected native dependency in both manifest and lock', async () => {
  const manifest = await fixture({ manifest: { dependencies: {} } });
  rejects(manifest.failures, 'selected database requires dependencies.');
  const lock = await fixture({
    lock: { packages: { '': { dependencies: nativeDependencies } } },
  });
  rejects(lock.failures, 'selected database requires locked');
});

test('rejects missing or malformed lock evidence', async () => {
  for (const lock of [
    '{invalid',
    '{}',
    '{"lockfileVersion":1,"dependencies":{}}',
  ]) {
    const result = await fixture({ files: { 'package-lock.json': lock } });
    rejects(result.failures, 'package-lock.json:');
  }
});

for (const source of [
  `import '${oppositeSdk}';`,
  `import type { Query } from '${oppositeSdk}'; export type Q = Query;`,
  `export type { Query } from '${oppositeSdk}';`,
  `export * from '${oppositeSdk}/native';`,
  `export type Query = import('${oppositeSdk}').Query;`,
  `import driver = require('${oppositeSdk}'); export { driver };`,
  `export const driver = require('${oppositeSdk}');`,
  `export const driver = import('${oppositeSdk}');`,
]) {
  test(`rejects opposite SDK dependency edge: ${source}`, async () => {
    const result = await fixture({ files: { 'src/bad.ts': source } });
    rejects(result.failures, 'unselected database SDK import');
  });
}

test('rejects unreferenced opposite database source files', async () => {
  const result = await fixture({
    files: {
      [`src/core/database/${oppositeFile}.ts`]: 'export const unused = true;',
    },
  });
  rejects(result.failures, 'unselected database source file');
});

test('rejects unused opposite source and resolves TS path aliases through type imports and re-exports', async () => {
  const result = await fixture({
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          paths: { '@native/*': ['./src/core/database/*'] },
        },
        include: ['src/**/*.ts'],
      }),
      [`src/core/database/${oppositeFile}.ts`]:
        'export type Hidden = { id: string };',
      'src/a.ts': `import type { Hidden } from '@native/${oppositeFile}.js'; export type A = Hidden;`,
      'src/b.ts': `export type { Hidden } from '@native/${oppositeFile}.js';`,
      'src/c.ts': `export type C = import('@native/${oppositeFile}.js').Hidden;`,
    },
  });
  rejects(
    result.failures,
    `src/core/database/${oppositeFile}.ts: unselected database source file`,
  );
  for (const file of ['a', 'b', 'c'])
    rejects(
      result.failures,
      `src/${file}.ts: import resolves to unselected database source`,
    );
});

test('rejects source imports escaping the independent project and unresolved relative imports', async () => {
  const result = await fixture({
    files: {
      'outside.ts': 'export type Foreign = string;',
      'src/a.ts': "export type { Foreign } from '../outside.js';",
      'src/b.ts': "export { missing } from './missing.js';",
    },
  });
  rejects(result.failures, 'import escapes application source');
  rejects(result.failures, 'unresolved local import');
});

for (const source of [
  "export type Driver = 'mongodb' | 'postgres';",
  'export type Database = MongoDatabase | PostgresDatabase;',
  "export const schema = z.enum(['mongodb', 'postgres']);",
  'export const config = { DATABASE_DRIVER: z.string() };',
  "export const driver = process.env['DATABASE_DRIVER'];",
  'export const connect = (config: Config) => config.database.driver ? mongo() : sql();',
  "export const connect = (db: Database) => db['driver'] ? mongo() : sql();",
  "export const config = { database: { driver: requested, url: '' } };",
  "export const connect = (kind: string) => kind === 'mongodb' ? mongo() : sql();",
  "export function connect(kind: string) { switch (kind) { case 'mongodb': return mongo(); default: return sql(); } }",
]) {
  test(`rejects runtime DB union or selection: ${source}`, async () => {
    const result = await fixture({ files: { 'src/config.ts': source } });
    assert.ok(
      result.failures.some((failure) =>
        /database (?:provider union|selector|configuration selector|switching)/.test(
          failure,
        ),
      ),
      result.failures.join('\n'),
    );
  });
}

for (const source of [
  'export interface RepositoryAdapter<T> { find(): T; }',
  'export type RepositoryDefinition = { name: string };',
  'export const definition = { mongo: { schema: {} }, postgres: { table: {} } };',
  'export type Definition = { mongo: unknown; postgres: unknown };',
]) {
  test(`rejects portable adapters and dual repository metadata: ${source}`, async () => {
    const result = await fixture({ files: { 'src/metadata.ts': source } });
    assert.ok(
      result.failures.some((failure) =>
        /(?:obsolete portable|dual database)/.test(failure),
      ),
      result.failures.join('\n'),
    );
  });
}

test('rejects an app memory backend even in development and without a driver union', async () => {
  const result = await fixture({
    files: {
      'src/core/database/memory-database.ts':
        'export class MemoryDatabase { readonly records = new Map(); }',
      'src/main.ts':
        "import { MemoryDatabase } from './core/database/memory-database.js'; export const database = new MemoryDatabase();",
    },
  });
  rejects(result.failures, 'application memory database source');
  rejects(result.failures, 'application memory database MemoryDatabase');
});

test('rejects application memory state stores while leaving test doubles outside src alone', async () => {
  const result = await fixture({
    files: {
      'src/modules/media/memory-media-state-store.ts':
        'export class MemoryMediaStateStore { readonly records = new Map(); }',
    },
  });
  rejects(result.failures, 'application memory database source');
  rejects(result.failures, 'application memory database MemoryMediaStateStore');
});

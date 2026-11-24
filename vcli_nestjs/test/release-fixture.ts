import assert from 'node:assert/strict';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import type { ReleaseStore } from '../templates/runtime/common/src/release/release-types.js';
import type { NativeBackupOperations } from '../templates/runtime/common/src/release/backup-types.js';
import type { NativeCommandRunner } from '../templates/runtime/common/src/release/native-command.js';

export const releaseFixtureRoot = resolve('var/cli-release');
type Loader = <T>(path: string) => Promise<T>;
const nativeCompilers = new Map<string, Promise<Loader>>();
export type NativeStoreModule = {
  NativeReleaseStore: { connect(url: string): Promise<ReleaseStore> };
};
export type NativeBackupModule = {
  NativeBackup: new (runner?: NativeCommandRunner) => NativeBackupOperations;
};
export type NativeProofAccess = {
  seed(url: string, id: string): Promise<void>;
  read(url: string, id: string): Promise<string | null>;
};
export function releaseFixture(
  database: 'mongodb' | 'postgres',
): Promise<Loader> {
  let promise = nativeCompilers.get(database);
  if (promise) return promise;
  promise = (async () => {
    const root = join(releaseFixtureRoot, database);
    await mkdir(join(root, 'src/release'), { recursive: true });
    await cp(
      'templates/runtime/common/src/release',
      join(root, 'src/release'),
      { recursive: true },
    );
    await cp(
      `templates/runtime/${database}/src/release`,
      join(root, 'src/release'),
      { recursive: true },
    );
    await mkdir(join(root, 'src/core/database'), { recursive: true });
    for (const name of [
      database === 'postgres' ? 'postgres-database.ts' : 'mongo-database.ts',
      'transaction-context.ts',
      'database-errors.ts',
    ])
      await cp(
        `templates/runtime/${database}/src/core/database/${name}`,
        join(root, 'src/core/database', name),
      );
    await mkdir(join(root, 'src/core/errors'), { recursive: true });
    await cp(
      'templates/runtime/common/src/core/errors/application-error.ts',
      join(root, 'src/core/errors/application-error.ts'),
    );
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    try {
      await symlink(
        resolve(
          `examples/reference-api${database === 'postgres' ? '-postgres' : ''}/node_modules`,
        ),
        join(root, 'node_modules'),
        'dir',
      );
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
    // This is test-owned native seed/read code, not a schema contribution in product output.
    const access =
      database === 'postgres'
        ? `import {Pool} from 'pg';
export async function seed(url:string,id:string):Promise<void>{const pool=new Pool({connectionString:url,max:1});try{await pool.query('CREATE TABLE IF NOT EXISTS release_proof_rows(id text PRIMARY KEY,value text NOT NULL)');await pool.query('INSERT INTO release_proof_rows(id,value) VALUES ($1,$2) ON CONFLICT DO NOTHING',[id,'preserved-private-row']);}finally{await pool.end();}}
export async function read(url:string,id:string):Promise<string|null>{const pool=new Pool({connectionString:url,max:1});try{const rows=await pool.query<{value:string}>('SELECT value FROM release_proof_rows WHERE id=$1',[id]);return rows.rows[0]?.value??null;}finally{await pool.end();}}`
        : `import {createConnection} from 'mongoose';
export async function seed(url:string,id:string):Promise<void>{const connection=await createConnection(url,{maxPoolSize:1}).asPromise();try{await connection.db!.collection<{_id:string;value:string}>('release_proof_rows').updateOne({_id:id},{$setOnInsert:{value:'preserved-private-row'}},{upsert:true});}finally{await connection.close();}}
export async function read(url:string,id:string):Promise<string|null>{const connection=await createConnection(url,{maxPoolSize:1}).asPromise();try{return (await connection.db!.collection<{_id:string;value:string}>('release_proof_rows').findOne({_id:id}))?.value??null;}finally{await connection.close();}}`;
    await writeFile(join(root, 'src/release/proof-access.ts'), access);
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noUncheckedIndexedAccess: true,
          esModuleInterop: true,
          skipLibCheck: true,
          rootDir: 'src',
          outDir: 'dist',
          types: ['node'],
        },
        include: ['src/**/*.ts'],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve('node_modules/typescript/bin/tsc'),
        '-p',
        join(root, 'tsconfig.json'),
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(
      result.status,
      0,
      `isolated ${database} release compiler: ${result.stdout}${result.stderr}`,
    );
    return async <T>(path: string) =>
      import(
        pathToFileURL(join(root, 'dist/release', path + '.js')).href
      ) as Promise<T>;
  })();
  nativeCompilers.set(database, promise);
  return promise;
}

let renderer:
  | Promise<{
      schema: typeof import('../src/recipes/render-schema.js');
      release: typeof import('../src/recipes/render-release.js');
      configuration: typeof import('../src/recipes/render-config.js');
    }>
  | undefined;
export function releaseRenderers() {
  return (renderer ??= (async () => {
    await mkdir(join(releaseFixtureRoot, 'generator'), { recursive: true });
    await writeFile(
      join(releaseFixtureRoot, 'package.json'),
      '{"type":"module"}',
    );
    const program = ts.createProgram(
      [
        resolve('src/recipes/render-schema.ts'),
        resolve('src/recipes/render-release.ts'),
        resolve('src/recipes/render-config.ts'),
      ],
      {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        noUncheckedIndexedAccess: true,
        rootDir: resolve('src'),
        outDir: join(releaseFixtureRoot, 'generator'),
        types: ['node'],
      },
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(
      diagnostics.length,
      0,
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    );
    program.emit();
    try {
      await symlink(
        resolve('templates'),
        join(releaseFixtureRoot, 'templates'),
        'dir',
      );
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
    return {
      schema: (await import(
        pathToFileURL(
          join(releaseFixtureRoot, 'generator/recipes/render-schema.js'),
        ).href
      )) as typeof import('../src/recipes/render-schema.js'),
      release: (await import(
        pathToFileURL(
          join(releaseFixtureRoot, 'generator/recipes/render-release.js'),
        ).href
      )) as typeof import('../src/recipes/render-release.js'),
      configuration: (await import(
        pathToFileURL(
          join(releaseFixtureRoot, 'generator/recipes/render-config.js'),
        ).href
      )) as typeof import('../src/recipes/render-config.js'),
    };
  })());
}

/** Generated selection static check: writes exclusively to this worker's ignored fixture. */
export async function compileReleaseCommands(
  database: 'postgres' | 'mongodb',
  files: readonly { path: string; content: string }[],
): Promise<void> {
  const root = join(releaseFixtureRoot, 'commands-' + database);
  await mkdir(root, { recursive: true });
  for (const file of files.filter(
    (file) =>
      file.path.endsWith('.ts') &&
      !file.path.includes('initialize-selected-schemas') &&
      !file.path.endsWith('initialize-database.ts'),
  )) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  await cp(
    join(releaseFixtureRoot, database, 'src/core/database'),
    join(root, 'src/core/database'),
    { recursive: true },
  );
  await cp(
    join(releaseFixtureRoot, database, 'src/core/errors'),
    join(root, 'src/core/errors'),
    { recursive: true },
  );
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  try {
    await symlink(
      resolve(
        `examples/reference-api${database === 'postgres' ? '-postgres' : ''}/node_modules`,
      ),
      join(root, 'node_modules'),
      'dir',
    );
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
  }
  const result = spawnSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--noEmit',
      '--types',
      'node',
      '--strict',
      '--skipLibCheck',
      '--esModuleInterop',
      '--target',
      'ES2023',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      ...files
        .filter(
          (file) =>
            file.path.endsWith('.ts') &&
            !file.path.includes('initialize-selected-schemas') &&
            !file.path.endsWith('initialize-database.ts'),
        )
        .map((file) => join(root, file.path)),
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(
    result.status,
    0,
    `isolated selected release commands: ${result.stdout}${result.stderr}`,
  );
}

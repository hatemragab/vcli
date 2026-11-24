import assert from 'node:assert/strict';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { linkGeneratedDependencies } from './generated-dependencies.ts';
import type { ProjectConfig } from '../src/contracts.ts';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
import type { PrincipalAuthority } from '../templates/runtime/common/src/core/auth/principal-authority.js';
import type { EventPublisher } from '../templates/runtime/common/src/core/realtime/event-publisher.js';
import type {
  Note,
  NoteDraft,
  NoteEdit,
} from '../templates/runtime/common/src/modules/notes/notes-input.js';
import type {
  CreateNoteResult,
  NotesPage,
} from '../templates/runtime/common/src/modules/notes/notes-result.js';

export type {
  Principal,
  PrincipalAuthority,
  EventPublisher,
  Note,
  NoteDraft,
  NoteEdit,
  CreateNoteResult,
  NotesPage,
};
export type Database = 'mongodb' | 'postgres';
export const notesFixtureRoot = resolve('var/cli-notes');
export interface NotesOperations {
  createOwned(
    principal: Principal,
    draft: NoteDraft,
    eventId: string,
  ): Promise<CreateNoteResult>;
  getOwned(principal: Principal, id: string): Promise<Note>;
  listOwned(principal: Principal, limit?: number): Promise<NotesPage>;
  editOwned(principal: Principal, id: string, patch: NoteEdit): Promise<Note>;
  removeOwned(principal: Principal, id: string): Promise<void>;
}
export type Loader = <T>(path: string) => Promise<T>;
export function notesConfig(
  database: Database,
  realtime?: string,
  media = false,
): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'notes-check', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: `database.${database}`, options: {} },
      auth: { recipe: 'auth.firebase', options: {} },
      notes: { recipe: 'example.notes', options: {} },
      ...(media
        ? {
            storage: { recipe: 'storage.local', options: {} },
            media: { recipe: 'media.private', options: {} },
          }
        : {}),
      ...(realtime
        ? { realtime: { recipe: `realtime.${realtime}`, options: {} } }
        : {}),
    },
  };
}
async function link(target: string, path: string): Promise<void> {
  try {
    await symlink(target, path, 'dir');
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
  }
}
function compile(
  roots: readonly string[],
  rootDir: string,
  outDir: string,
  extra: ts.CompilerOptions = {},
): void {
  const program = ts.createProgram([...roots], {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noUncheckedIndexedAccess: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    rootDir,
    outDir,
    types: ['node'],
    ...extra,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (p) => p,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  program.emit();
}
let renderer:
  | Promise<{
      notes: typeof import('../src/recipes/render-notes.js');
      schema: typeof import('../src/recipes/render-schema.js');
      scaffold: typeof import('../src/recipes/render-scaffold.js');
      catalog: typeof import('../src/recipes/catalog.js');
    }>
  | undefined;
export function notesRenderers() {
  return (renderer ??= (async () => {
    const root = join(notesFixtureRoot, 'generator');
    await mkdir(root, { recursive: true });
    await writeFile(
      join(notesFixtureRoot, 'package.json'),
      '{"type":"module"}\n',
    );
    await link(resolve('templates'), join(notesFixtureRoot, 'templates'));
    compile(
      ['render-notes', 'render-schema', 'render-scaffold', 'catalog'].map(
        (name) => resolve(`src/recipes/${name}.ts`),
      ),
      resolve('src'),
      root,
    );
    return {
      notes: (await import(
        pathToFileURL(join(root, 'recipes/render-notes.js')).href
      )) as typeof import('../src/recipes/render-notes.js'),
      schema: (await import(
        pathToFileURL(join(root, 'recipes/render-schema.js')).href
      )) as typeof import('../src/recipes/render-schema.js'),
      scaffold: (await import(
        pathToFileURL(join(root, 'recipes/render-scaffold.js')).href
      )) as typeof import('../src/recipes/render-scaffold.js'),
      catalog: (await import(
        pathToFileURL(join(root, 'recipes/catalog.js')).href
      )) as typeof import('../src/recipes/catalog.js'),
    };
  })());
}

/** Compile the real selected Media closure without starting databases or providers. */
export async function compileNotesWithMedia(database: Database) {
  const root = join(notesFixtureRoot, database + '-media');
  const config = notesConfig(database, undefined, true);
  const {
    catalog: { recipeCatalog },
  } = await notesRenderers();
  const resolved = recipeCatalog.recipes.filter(
    (recipe) => config.capabilities[recipe.family]?.recipe === recipe.id,
  );
  const { files } = await recipeCatalog.render(config, resolved);
  const sources: string[] = [];
  for (const file of files) {
    const source = file.path.startsWith('src/') && file.path.endsWith('.ts');
    if (!source && file.path !== 'package.json') continue;
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
    if (source) sources.push(target);
  }
  await linkGeneratedDependencies(root);
  compile(sources, join(root, 'src'), join(root, 'out'), { noEmit: true });
}
const fixtures = new Map<Database, Promise<{ root: string; load: Loader }>>();
export function notesFixture(database: Database) {
  let promise = fixtures.get(database);
  if (promise) return promise;
  promise = (async () => {
    const root = join(notesFixtureRoot, database);
    const { notes } = await notesRenderers();
    const files = await notes.notesFiles(notesConfig(database));
    for (const file of files) {
      const target = join(root, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }
    await cp(
      `templates/runtime/${database}/src/core/database`,
      join(root, 'src/core/database'),
      { recursive: true },
    );
    const accounts = join(root, 'src/modules/accounts');
    await mkdir(accounts, { recursive: true });
    for (const file of ['account.entity.ts', 'account.service.ts']) {
      await cp(
        `templates/runtime/${database}/src/modules/accounts/${file}`,
        join(accounts, file),
      );
    }
    for (const path of [
      'auth/principal.ts',
      'auth/principal-authority.ts',
      'bootstrap/bootstrap-bindings.ts',
      'database/module-seeder.ts',
      'database/seed-error.ts',
      'errors/application-error.ts',
      'http/principal.guard.ts',
      'http/current-principal.decorator.ts',
      'http/parse-input.ts',
      'http/http-security.module.ts',
    ]) {
      const target = join(root, 'src/core', path);
      await mkdir(dirname(target), { recursive: true });
      await cp('templates/runtime/common/src/core/' + path, target);
    }
    await mkdir(join(root, 'src/core/config'), { recursive: true });
    await writeFile(
      join(root, 'src/core/config/app-config.ts'),
      'export type AppConfig={database:{url:string}};\n',
    );
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    await linkGeneratedDependencies(root);
    await cp(
      'templates/runtime/common/scripts/architecture-rules.ts',
      join(root, 'architecture-rules.ts'),
    );
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          noUncheckedIndexedAccess: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          types: ['node'],
        },
      }),
    );
    const access =
      database === 'mongodb'
        ? `import {createConnection} from 'mongoose';
import {NotesService} from './modules/notes/notes.service.js';
export function controlledDatabase(){return {connection:createConnection()};}
export async function cleanup(database:import('./core/database/mongo-database.js').MongoDatabase,ownerIds:readonly string[]){await database.connection.db!.collection('app_notes').deleteMany({ownerId:{$in:[...ownerIds]}});}
export async function rejectInvalid(database:import('./core/database/mongo-database.js').MongoDatabase,id:string,ownerId:string){await database.connection.db!.collection<{_id:string;id:string;ownerId:string;title:string;body:string;createdAt:number}>('app_notes').insertOne({_id:id,id,ownerId,title:' ',body:'',createdAt:1});}
export async function read(database:import('./core/database/mongo-database.js').MongoDatabase,id:string){const row=await database.connection.db!.collection('app_notes').findOne({id});return row?{id:row.id,title:row.title}:null;}
export {NotesService};`
        : `import {sql} from 'drizzle-orm';
import {NotesService} from './modules/notes/notes.service.js';
export function controlledDatabase(){return {};}
export async function cleanup(database:import('./core/database/postgres-database.js').PostgresDatabase,ownerIds:readonly string[]){for(const ownerId of ownerIds) await database.db.execute(sql\`DELETE FROM app_notes WHERE owner_id=\${ownerId}\`);}
export async function rejectInvalid(database:import('./core/database/postgres-database.js').PostgresDatabase,id:string,ownerId:string){await database.db.execute(sql\`INSERT INTO app_notes (id,owner_id,title,body,created_at) VALUES (\${id},\${ownerId},' ','',1)\`);}
export async function read(database:import('./core/database/postgres-database.js').PostgresDatabase,id:string){const rows=await database.db.execute<{id:string;title:string}>(sql\`SELECT id,title FROM app_notes WHERE id=\${id}\`);return rows.rows[0]??null;}
export {NotesService};`;
    await writeFile(join(root, 'src/test-access.ts'), access);
    // This loopback server uses actual Nest guard/controller/DI, a synthetic authority and controlled test persistence only.
    await writeFile(
      join(root, 'src/test-http.ts'),
      `import 'reflect-metadata';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {withBootstrapBindings} from './core/bootstrap/bootstrap-bindings.js';
import {bindPrincipalAuthority} from './core/http/http-security.module.js';
import {NotesModule,bindNotesService} from './modules/notes/notes.module.js';
import type {NotesService} from './modules/notes/notes.service.js';
import {ApplicationError} from './core/errors/application-error.js';
import type {PrincipalAuthority} from './core/auth/principal-authority.js';
@Module({imports:[NotesModule]}) class TestRoot {}
export async function startHttp(authority:PrincipalAuthority,service:NotesService){
  const app=await withBootstrapBindings([bindPrincipalAuthority(authority),bindNotesService(service)],()=>NestFactory.create(TestRoot,{logger:false,abortOnError:false}));
  try {app.setGlobalPrefix('api');app.useGlobalFilters({catch(error:unknown,host:import('@nestjs/common').ArgumentsHost){const response=host.switchToHttp().getResponse<import('express').Response>();const status=error instanceof ApplicationError?error.status:500;response.status(status).json({error:{code:error instanceof ApplicationError?error.code:'INTERNAL_ERROR'}});}});await app.listen(0,'127.0.0.1');return {url:await app.getUrl(),close:()=>app.close()};}
  catch(error){await app.close();throw error;}
}`,
    );
    const sourceFiles: string[] = [];
    const walk = async (path: string): Promise<void> => {
      for (const entry of await import('node:fs/promises').then((fs) =>
        fs.readdir(path, { withFileTypes: true }),
      )) {
        if (entry.isDirectory()) await walk(join(path, entry.name));
        else if (entry.name.endsWith('.ts'))
          sourceFiles.push(join(path, entry.name));
      }
    };
    await walk(join(root, 'src'));
    compile(sourceFiles, join(root, 'src'), join(root, 'out'));
    return {
      root,
      load: async <T>(path: string) =>
        import(
          pathToFileURL(join(root, 'out', path + '.js')).href
        ) as Promise<T>,
    };
  })();
  fixtures.set(database, promise);
  return promise;
}
export interface TestAccess {
  controlledDatabase(): unknown;
  NotesService: new (
    database: unknown,
    authority: PrincipalAuthority,
    publisher?: EventPublisher,
  ) => NotesOperations & {
    create(note: Note): Promise<Note>;
    findOne(...args: unknown[]): Promise<Note | null>;
    findMany(...args: unknown[]): Promise<Note[]>;
  };
  cleanup(database: unknown, ownerIds: readonly string[]): Promise<void>;
  rejectInvalid(database: unknown, id: string, ownerId: string): Promise<void>;
  read(
    database: unknown,
    id: string,
  ): Promise<{ id: string; title: string } | null>;
}
export interface HttpFixture {
  startHttp(
    authority: PrincipalAuthority,
    service: NotesOperations,
  ): Promise<{ url: string; close(): Promise<void> }>;
}
export async function sourceText(path: string) {
  return readFile(path, 'utf8');
}

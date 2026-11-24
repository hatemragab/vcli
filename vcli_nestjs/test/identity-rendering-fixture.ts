import assert from 'node:assert/strict';
import { cp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { ProjectConfig, RenderedFile } from '../src/contracts.js';
import { linkGeneratedDependencies } from './generated-dependencies.ts';

const directory = resolve('var/cli-identity-integration');
let rendering:
  Promise<typeof import('../src/recipes/render-identity.js')> | undefined;

export function identityRenderer(): Promise<
  typeof import('../src/recipes/render-identity.js')
> {
  return (rendering ??= (async () => {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      noUncheckedIndexedAccess: true,
      rootDir: resolve('src'),
      outDir: join(directory, 'generator'),
      types: ['node'],
    };
    const program = ts.createProgram(
      [resolve('src/recipes/index.ts')],
      options,
    );
    assertNoDiagnostics(program);
    program.emit();
    try {
      await symlink(resolve('templates'), join(directory, 'templates'), 'dir');
    } catch (error: unknown) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
    return import(
      pathToFileURL(join(directory, 'generator/recipes/render-identity.js'))
        .href
    );
  })());
}

export function identitySelection(
  database: 'mongodb' | 'postgres',
  auth: 'local' | 'firebase',
  mode: 'immediate' | 'reliable' | 'provider' | 'application',
): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'identity-rendering', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: 'database.' + database, options: {} },
      auth: {
        recipe: 'auth.' + auth,
        options:
          auth === 'firebase'
            ? {
                methods: ['email-password', 'phone', 'google', 'apple'],
                actionDelivery:
                  mode === 'application' ? 'application' : 'provider',
              }
            : {},
      },
      ...(auth === 'local' || mode === 'application'
        ? {
            mail: {
              recipe: 'mail.capture',
              options: {
                reliableActions: mode === 'reliable' || mode === 'application',
              },
            },
          }
        : {}),
    },
  };
}

export async function selectedIdentityFixture(
  database: 'mongodb' | 'postgres',
  auth: 'local' | 'firebase',
  mode: 'immediate' | 'reliable' | 'provider' | 'application',
) {
  const renderer = await identityRenderer(),
    config = identitySelection(database, auth, mode),
    files = await renderer.identityFiles(config);
  const target = join(directory, [database, auth, mode].join('-'));
  await rm(join(target, 'src'), { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'package.json'), '{"type":"module"}');
  await linkGeneratedDependencies(target);
  async function put(path: string, content: string) {
    const absolute = join(target, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
  }
  for (const entry of files) await put(entry.path, entry.content);
  await cp(
    `templates/runtime/${database}/src/core/database`,
    join(target, 'src/core/database'),
    { recursive: true },
  );
  const Database =
    database === 'postgres' ? 'PostgresDatabase' : 'MongoDatabase';
  await mkdir(join(target, 'src/core/bootstrap'), { recursive: true });
  await cp(
    'templates/runtime/common/src/core/bootstrap/bootstrap-bindings.ts',
    join(target, 'src/core/bootstrap/bootstrap-bindings.ts'),
  );
  await put(
    'src/core/database/database.module.ts',
    `import {Module} from '@nestjs/common';
import {bootstrapBinding} from '../bootstrap/bootstrap-bindings.js';
import {${Database}} from './${database === 'postgres' ? 'postgres' : 'mongo'}-database.js';
const databaseBinding=bootstrapBinding(${Database});
export const bindDatabase=databaseBinding.bind;
@Module({providers:[databaseBinding.provider],exports:[${Database}]})
export class DatabaseModule {}`,
  );
  await mkdir(join(target, 'src/core/errors'), { recursive: true });
  await cp(
    'templates/runtime/common/src/core/errors/application-error.ts',
    join(target, 'src/core/errors/application-error.ts'),
  );
  // Mail owns its sources. Read its neutral contracts/helpers as isolated integration inputs.
  if (auth === 'local' || mode === 'application') {
    await cp(
      'templates/runtime/common/src/core/mail',
      join(target, 'src/core/mail'),
      { recursive: true },
    );
  }
  if (mode === 'application') {
    for (const path of [
      'firebase-action-links.service.ts',
      'firebase-action-policy.ts',
      'render-message.ts',
    ]) {
      await mkdir(join(target, 'src/modules/mail'), { recursive: true });
      await cp(
        'templates/runtime/common/src/modules/mail/' + path,
        join(target, 'src/modules/mail', path),
      );
    }
  }
  // Frozen coordinator config contract, not evidence of root config-renderer completion.
  await put(
    'src/core/config/app-config.ts',
    `${auth === 'local' ? "import type {JwtPolicy} from '@vcli/auth-runtime/jwt';" : ''}
${mode === 'application' ? "import type {FirebaseActionPolicy} from '../../modules/mail/firebase-action-policy.js';" : ''}
export type AppConfig=Readonly<{publicOrigin:string;database:{driver:'${database}';url:string};auth:{rateLimitRedisUrl:string;rateLimitNamespace:string;sessionTtlSeconds:number;recentAuthSeconds:number;${auth === 'local' ? 'jwtPolicy:JwtPolicy;accessTtlSeconds:number;' : 'firebaseProjectId:string;firebaseMethods:readonly string[];'}};${mode === 'reliable' || mode === 'application' ? 'mailDelivery:{activeKeyId:string;keys:Record<string,string>;maxAttempts:number;leaseMs:number;maxLifetimeMs:number};' : ''}${mode === 'application' ? 'firebaseActions:{policy:FirebaseActionPolicy;continueUrl:string;applicationName:string;deliveryLifetimeMs:number};' : ''}}>;`,
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noUncheckedIndexedAccess: true,
    types: ['node'],
    rootDir: join(target, 'src'),
    outDir: join(target, 'out'),
  };
  const roots = [
    ...files
      .filter(
        (file) => file.path.startsWith('src/') && file.path.endsWith('.ts'),
      )
      .map((file) => join(target, file.path)),
    join(target, 'src/core/database/database.module.ts'),
  ];
  const program = ts.createProgram(roots, options);
  assertNoDiagnostics(program);
  await put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        ...options,
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        rootDir: 'src',
        outDir: 'out',
      },
      include: ['src/**/*.ts'],
    }),
  );
  const load = async (relative: string) =>
    import(pathToFileURL(join(target, 'out', relative + '.js')).href);
  return {
    directory: target,
    files,
    config,
    program,
    load,
    emit: () => program.emit(),
  };
}
export function contents(files: readonly RenderedFile[], path: string): string {
  const entry = files.find((file) => file.path === path);
  assert.ok(entry, path);
  return entry.content;
}
function assertNoDiagnostics(program: ts.Program) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
}

/** Full current source renderer, compiled only into this worker-owned fixture. */
export async function generatedIdentityProject(config: ProjectConfig) {
  await identityRenderer();
  const { recipeCatalog }: typeof import('../src/recipes/index.js') =
    await import(
      pathToFileURL(join(directory, 'generator/recipes/index.js')).href
    );
  const resolved = Object.values(config.capabilities).map((value) => {
    const recipe = recipeCatalog.recipes.find(
      (recipe) => recipe.id === value.recipe,
    );
    assert.ok(recipe);
    return recipe;
  });
  return recipeCatalog.render(config, resolved);
}

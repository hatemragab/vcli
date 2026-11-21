import { cp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Isolated compilation only: no generated-app install/build/provider evidence. */
export async function identityFixture(database: 'mongodb' | 'postgres') {
  const directory = resolve('var/cli-identity-lifecycle', database);
  await rm(join(directory, 'src'), { recursive: true, force: true });
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  try {
    await symlink(
      resolve(
        `examples/reference-api${database === 'postgres' ? '-postgres' : ''}/node_modules`,
      ),
      join(directory, 'node_modules'),
      'dir',
    );
  } catch (error: unknown) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
  }
  await cp('templates/runtime/common/src/core', join(directory, 'src/core'), {
    recursive: true,
  });
  await cp(
    `templates/runtime/${database}/src/core/database`,
    join(directory, 'src/core/database'),
    { recursive: true },
  );
  for (const name of ['identity', 'accounts', 'installations', 'sessions']) {
    await cp(
      `templates/runtime/common/src/modules/${name}`,
      join(directory, 'src/modules', name),
      { recursive: true },
    );
    await cp(
      `templates/runtime/${database}/src/modules/${name}`,
      join(directory, 'src/modules', name),
      { recursive: true },
    );
  }
  await mkdir(join(directory, 'src/modules/mail'), { recursive: true });
  for (const name of [
    'firebase-action-links.service.ts',
    'firebase-action-policy.ts',
    'render-message.ts',
  ]) {
    await cp(
      'templates/runtime/common/src/modules/mail/' + name,
      join(directory, 'src/modules/mail', name),
    );
  }
  await mkdir(join(directory, 'src/core/config'), { recursive: true });
  await writeFile(
    join(directory, 'src/core/config/app-config.ts'),
    'export type AppConfig={publicOrigin:string;auth:{sessionTtlSeconds:number;accessTtlSeconds:number;recentAuthSeconds:number}};\n',
  );
  await writeFile(
    join(directory, 'src/modules/identity/identity.tokens.ts'),
    "export const IDENTITY_CONFIG=Symbol('IdentityConfig');export const ACCESS_TOKENS=Symbol('AccessTokens');\n",
  );
  async function files(path: string): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) result.push(...(await files(name)));
      else if (name.endsWith('.ts')) result.push(name);
    }
    return result;
  }
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
    rootDir: join(directory, 'src'),
    outDir: join(directory, 'out'),
  };
  const program = ts.createProgram(
    await files(join(directory, 'src/modules')),
    options,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
      }),
    );
  program.emit();
  return Object.assign(
    async (relative: string) =>
      import(pathToFileURL(join(directory, 'out', relative + '.js')).href),
    { directory },
  );
}

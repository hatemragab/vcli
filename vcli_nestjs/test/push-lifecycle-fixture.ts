import assert from 'node:assert/strict';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { linkGeneratedDependencies } from './generated-dependencies.ts';
export const pushFixtureRoot = resolve('var/cli-push');
/** Installed caches only, writes confined to worker-owned ignored fixtures. Never touches shared builds. */
export async function pushFixture(database: 'mongodb' | 'postgres') {
  const root = `${pushFixtureRoot}/${database}`;
  await rm(`${root}/src`, { recursive: true, force: true });
  await mkdir(`${root}/src/modules/push`, { recursive: true });
  await cp(
    'templates/runtime/common/src/modules/push',
    `${root}/src/modules/push`,
    { recursive: true },
  );
  await cp(
    `templates/runtime/${database}/src/modules/push`,
    `${root}/src/modules/push`,
    { recursive: true },
  );
  for (const sub of [
    'core/auth',
    'core/bootstrap',
    'core/errors',
    'core/http',
  ]) {
    await mkdir(`${root}/src/${sub}`, { recursive: true });
  }
  for (const [sub, files] of Object.entries({
    'core/auth': ['principal.ts', 'principal-authority.ts'],
    'core/bootstrap': ['bootstrap-bindings.ts'],
    'core/errors': ['application-error.ts'],
    'core/http': [
      'parse-input.ts',
      'principal.guard.ts',
      'current-principal.decorator.ts',
      'http-security.module.ts',
    ],
  }))
    for (const name of files)
      await cp(
        `templates/runtime/common/src/${sub}/${name}`,
        `${root}/src/${sub}/${name}`,
      );
  await writeFile(`${root}/package.json`, '{"type":"module"}\n');
  await linkGeneratedDependencies(root);
  await writeFile(
    `${root}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noUncheckedIndexedAccess: true,
        esModuleInterop: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        rootDir: 'src',
        outDir: 'dist',
        types: ['node'],
      },
      include: ['src/**/*.ts'],
    }),
  );
  const compile = spawnSync(
    process.execPath,
    [resolve('node_modules/typescript/bin/tsc'), '-p', `${root}/tsconfig.json`],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(
    compile.status,
    0,
    `${database} isolated compiler: ${compile.stdout}${compile.stderr}`,
  );
  return async <T>(path: string): Promise<T> =>
    import(pathToFileURL(`${root}/dist/${path}.js`).href) as Promise<T>;
}

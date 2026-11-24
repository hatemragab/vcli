import { TOOL_VERSION } from '../dist/contracts.js';
import assert from 'node:assert/strict';
import { cp, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const maintenanceFixture = resolve('var/cli-maintenance');
let prepared: Promise<void> | undefined;
export function prepareMaintenanceFixture(): Promise<void> {
  return (prepared ??= (async () => {
    await mkdir(maintenanceFixture, { recursive: true });
    await writeFile(
      `${maintenanceFixture}/package.json`,
      JSON.stringify({ type: 'module' }),
    );
    const files = ['src/contracts.ts'];
    for (const directory of ['src/engine', 'src/maintenance'])
      for (const file of await readdir(directory))
        if (file.endsWith('.ts')) files.push(`${directory}/${file}`);
    files.push(
      'src/recipes/render-mail.ts',
      'src/recipes/bundle.ts',
      'src/recipes/selection.ts',
    );
    const compiler = spawnSync(
      process.execPath,
      [
        'node_modules/typescript/bin/tsc',
        '--ignoreConfig',
        '--target',
        'ES2023',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--strict',
        '--esModuleInterop',
        '--skipLibCheck',
        '--noUncheckedIndexedAccess',
        '--types',
        'node',
        '--rootDir',
        'src',
        '--outDir',
        `${maintenanceFixture}/compiler`,
        ...files,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr);
    try {
      await symlink(
        resolve('templates'),
        `${maintenanceFixture}/templates`,
        'dir',
      );
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
    }
    const runtime = `${maintenanceFixture}/runtime`;
    for (const file of [
      'core/mail/mail-submitter.ts',
      'core/errors/application-error.ts',
      'modules/mail/mail.service.ts',
      'modules/mail/render-message.ts',
      'modules/mail/http-mail-protocol.ts',
      'modules/mail/http-mail.service.ts',
    ]) {
      await mkdir(`${runtime}/src/${file.slice(0, file.lastIndexOf('/'))}`, {
        recursive: true,
      });
      await cp(
        `templates/runtime/common/src/${file}`,
        `${runtime}/src/${file}`,
      );
    }
    await writeFile(
      `${runtime}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
          noUncheckedIndexedAccess: true,
          outDir: 'dist',
          rootDir: 'src',
          types: ['node'],
        },
        include: ['src/**/*.ts'],
      }),
    );
    const http = spawnSync(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '-p', `${runtime}/tsconfig.json`],
      { encoding: 'utf8' },
    );
    assert.equal(http.status, 0, http.stdout + http.stderr);
    for (const version of ['0.1.0', TOOL_VERSION]) {
      const directory = `${maintenanceFixture}/auth-${version}`;
      await mkdir(`${directory}/src`, { recursive: true });
      for (const file of ['auth-runtime-error.ts', 'errors.ts', 'opaque.ts'])
        await cp(
          `packages/auth-runtime/src/${file}`,
          `${directory}/src/${file}`,
        );
      if (version === TOOL_VERSION)
        await cp(
          'packages/auth-runtime/src/index.ts',
          `${directory}/src/index.ts`,
        );
      else
        await writeFile(
          `${directory}/src/index.ts`,
          "export { AuthRuntimeError } from './errors.js';\nexport type { AuthRuntimeErrorCode } from './errors.js';\n",
        );
      await writeFile(
        `${directory}/tsconfig.json`,
        JSON.stringify({
          compilerOptions: {
            target: 'ES2023',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            skipLibCheck: true,
            outDir: 'dist',
            rootDir: 'src',
            types: ['node'],
          },
          include: ['src/**/*.ts'],
        }),
      );
      const auth = spawnSync(
        process.execPath,
        ['node_modules/typescript/bin/tsc', '-p', `${directory}/tsconfig.json`],
        { encoding: 'utf8' },
      );
      assert.equal(auth.status, 0, auth.stdout + auth.stderr);
    }
  })());
}
export async function maintenanceModule<T>(file: string): Promise<T> {
  await prepareMaintenanceFixture();
  return (await import(
    pathToFileURL(`${maintenanceFixture}/compiler/${file}.js`).href
  )) as T;
}
export async function httpMailModule(): Promise<
  typeof import('../templates/runtime/common/src/modules/mail/http-mail.service.js')
> {
  await prepareMaintenanceFixture();
  return (await import(
    pathToFileURL(
      `${maintenanceFixture}/runtime/dist/modules/mail/http-mail.service.js`,
    ).href
  )) as typeof import('../templates/runtime/common/src/modules/mail/http-mail.service.js');
}

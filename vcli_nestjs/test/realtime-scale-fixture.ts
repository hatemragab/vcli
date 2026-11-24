import ts from 'typescript';
import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  symlink,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import type { ProjectConfig } from '../src/contracts.ts';
import { linkGeneratedDependencies } from './generated-dependencies.ts';
export const fixtureRoot = resolve('var/cli-realtime');
export async function realtimeFixture(
  database: 'mongodb' | 'postgres',
  directory = fixtureRoot,
) {
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(join(directory, `${database}-`));
  await mkdir(`${root}/src`, { recursive: true });
  await cp(
    'templates/runtime/common/src/modules/realtime',
    `${root}/src/modules/realtime`,
    { recursive: true },
  );
  await cp(
    `templates/runtime/${database}/src/modules/realtime`,
    `${root}/src/modules/realtime`,
    { recursive: true },
  );
  for (const sub of [
    'auth',
    'bootstrap',
    'errors',
    'http',
    'realtime',
    'logging',
    'diagnostics',
  ]) {
    await mkdir(`${root}/src/core/${sub}`, { recursive: true });
  }
  for (const [sub, files] of Object.entries({
    auth: ['principal.ts', 'principal-authority.ts'],
    bootstrap: ['bootstrap-bindings.ts'],
    errors: ['application-error.ts'],
    http: [
      'principal.guard.ts',
      'current-principal.decorator.ts',
      'http-security.module.ts',
    ],
    logging: ['log-event-schema.ts', 'diagnostic-catalog.ts'],
    diagnostics: ['diagnostic-events.ts'],
  })) {
    for (const name of files)
      await cp(
        `templates/runtime/common/src/core/${sub}/${name}`,
        `${root}/src/core/${sub}/${name}`,
      );
  }
  await cp(
    'templates/runtime/common/src/core/realtime',
    `${root}/src/core/realtime`,
    { recursive: true },
  );
  await cp(
    `templates/runtime/${database}/src/core/database`,
    `${root}/src/core/database`,
    { recursive: true },
  );
  await mkdir(`${root}/src/core/config`, { recursive: true });
  await writeFile(
    `${root}/src/core/config/app-config.ts`,
    `export type AppConfig={database:{url:string};allowedOrigins:string[];auth:{driver:'local'|'firebase'};realtime:{driver:'socketio'|'ws'|'centrifugo';scale:'single-instance'|'cluster';path:string;maxPayloadBytes:number;ticketTtlSeconds:number;centrifugoApiUrl:string;centrifugoApiKey:string;centrifugoProxySecret:string}};\n`,
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
        emitDecoratorMetadata: true,
        rootDir: 'src',
        outDir: 'out',
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
    `${database} isolated compilation: ${compile.stdout}${compile.stderr}`,
  );
  return {
    root,
    load: async <T>(path: string): Promise<T> =>
      import(pathToFileURL(`${root}/out/${path}.js`).href) as Promise<T>,
  };
}
export function realtimeConfig(
  database: 'mongodb' | 'postgres',
  transport: string,
  scale = 'single-instance',
): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'realtime-check', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      database: { recipe: `database.${database}`, options: {} },
      auth: { recipe: 'auth.firebase', options: {} },
      realtime: { recipe: `realtime.${transport}`, options: { scale } },
    },
  } as ProjectConfig;
}
export async function renderedRealtime(
  database: 'mongodb' | 'postgres',
  transport: string,
  scale = 'single-instance',
) {
  const root = fixtureRoot + '/renderer';
  await mkdir(root + '/dist/recipes', { recursive: true });
  await writeFile(root + '/package.json', '{"type":"module"}');
  for (const [target, link] of [
    [resolve('templates'), root + '/templates'],
    [resolve('node_modules'), root + '/node_modules'],
  ] as const) {
    try {
      await symlink(target, link, 'dir');
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
    }
  }
  const contractsSource = await readFile('src/contracts.ts', 'utf8');
  await writeFile(
    root + '/dist/contracts.js',
    ts.transpileModule(contractsSource, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
  for (const name of ['render-realtime', 'bundle', 'selection']) {
    const source = await readFile('src/recipes/' + name + '.ts', 'utf8');
    await writeFile(
      root + '/dist/recipes/' + name + '.js',
      ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ES2022,
        },
      }).outputText,
    );
  }
  const { realtimeFiles } = (await import(
    pathToFileURL(root + '/dist/recipes/render-realtime.js').href
  )) as {
    realtimeFiles(
      config: ProjectConfig,
    ): Promise<import('../src/contracts.ts').RenderedFile[]>;
  };
  return realtimeFiles(realtimeConfig(database, transport, scale));
}

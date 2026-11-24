import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { file, json } from './bundle.js';
import { selection } from './selection.js';
const pins: Record<string, string> = {
  '@nestjs/common': '12.4.2',
  '@nestjs/core': '12.4.2',
  '@nestjs/platform-express': '12.4.2',
  '@nestjs/swagger': '12.1.1',
  '@aws-sdk/client-s3': '3.1164.0',
  '@aws-sdk/s3-presigned-post': '3.1164.0',
  '@redis/client': '6.4.0',
  '@vcli/auth-runtime': 'file:tools/vcli-auth-runtime',
  '@socket.io/mongo-adapter': '0.4.0',
  '@socket.io/postgres-adapter': '0.5.0',
  mongodb: '7.8.0',
  centrifuge: '5.8.0',
  'socket.io-client': '4.8.4',
  firebase: '13.4.0',
  '@modelcontextprotocol/sdk': '1.32.2',
  argon2: '0.45.2',
  dotenv: '18.0.10',
  express: '5.3.0',
  'firebase-admin': '14.5.0',
  jose: '6.2.16',
  mongoose: '9.12.0',
  'drizzle-orm': '0.45.4',
  pg: '8.23.1',
  nodemailer: '10.4.0',
  pino: '10.4.0',
  'reflect-metadata': '0.2.2',
  rxjs: '7.8.2',
  'socket.io': '4.8.4',
  ws: '8.23.0',
  zod: '4.6.7',
};
const sorted = (input: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
  );
export function packageFile(
  config: ProjectConfig,
  files: readonly RenderedFile[],
): RenderedFile {
  const dependencies: Record<string, string> = {};
  for (const name of [
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/platform-express',
    'express',
    'reflect-metadata',
    'rxjs',
    'dotenv',
    'pino',
    'zod',
  ])
    dependencies[name] = pins[name]!;
  // Scan only selected bundled source imports. An unmapped package is a packaging defect.
  for (const source of files.filter(
    (f) => f.path.endsWith('.ts') || f.path.endsWith('.mjs'),
  )) {
    if (
      !source.path.startsWith('src/') &&
      !(source.path.startsWith('scripts/') && source.path.endsWith('.mjs'))
    )
      continue;
    for (const match of source.content.matchAll(
      /(?:from\s+|import\s*)['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1]!;
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]!;
      if (!pins[name]) throw new Error('UNPINNED_TEMPLATE_DEPENDENCY:' + name);
      dependencies[name] = pins[name]!;
    }
  }
  const devDependencies: Record<string, string> = {
    '@vcli/cli': 'file:tools/vcli',
    '@eslint/js': '10.0.1',
    '@nestjs/cli': '12.0.13',
    '@types/express': '5.0.6',
    '@types/node': '26.6.6',
    eslint: '10.15.0',
    prettier: '3.10.1',
    typescript: '6.0.3',
    'typescript-eslint': '8.73.0',
  };
  if (dependencies['@socket.io/mongo-adapter'])
    dependencies.mongodb = pins.mongodb!;
  // Client examples are development inputs, never backend production SDKs.
  for (const source of files.filter(
    (file) =>
      file.path.startsWith('clients/') && /\.(?:mjs|ts)$/.test(file.path),
  )) {
    for (const match of source.content.matchAll(
      /(?:from\s+|import\s*)['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1]!;
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0]!;
      if (!pins[name]) throw new Error('UNPINNED_CLIENT_DEPENDENCY:' + name);
      devDependencies[name] = pins[name]!;
    }
  }
  if (dependencies.pg) devDependencies['@types/pg'] = '8.23.1';
  if (selection(config, 'auth') === 'auth.local') {
    dependencies.jose = pins.jose!;
    dependencies.argon2 = pins.argon2!;
  }
  if (dependencies.ws) devDependencies['@types/ws'] = '8.18.2';
  if (dependencies.nodemailer) devDependencies['@types/nodemailer'] = '8.0.2';
  const scripts: Record<string, string> = {
    build: 'nest build && node scripts/write-build-metadata.mjs',
    start: 'node dist/main.js',
    'start:dev': 'nest start --watch',
    'start:prod': 'NODE_ENV=production node dist/main.js',
    typecheck: 'tsc --noEmit',
    lint: 'eslint src',
    format: 'prettier --write src',
    'format:check': 'prettier --check src',
    check:
      'npm run check:architecture && npm run check:database && npm run lint && npm run typecheck',
    'check:architecture': 'node scripts/check-architecture.ts',
    'check:database': 'node scripts/check-database.ts',
    prebuild: 'npm run check:architecture && npm run check:database',
    test: 'node --test test/*.test.mjs',
  };
  if (selection(config, 'database')) {
    scripts['db:initialize'] = 'node dist/initialize-database.js';
    scripts['db:seed'] = 'node scripts/seed.mjs';
    scripts['release:apply'] = 'node dist/initialize-database.js';
    scripts['release:reconcile'] = 'node dist/release/reconcile-command.js';
    scripts['backup:create'] = 'node dist/release/backup-command.js';
    scripts['backup:restore'] = 'node dist/release/restore-command.js';
  }
  if (config.capabilities.diagnostics?.options.mcp)
    scripts['diagnostics:mcp'] = 'node scripts/diagnostics-mcp.mjs';
  if (config.capabilities.mail?.options.reliableActions === true)
    scripts['mail:drain'] = 'node dist/drain-mail.js';
  if (selection(config, 'auth') === 'auth.firebase')
    scripts['identity:cleanup'] = 'node dist/drain-identity-cleanup.js';
  if (config.capabilities.diagnostics?.options.testCapture)
    scripts['diagnostics:check'] = 'node dist/run-diagnostic-check.js';
  if (
    config.capabilities.diagnostics?.options.reader === 'restricted-remote-read'
  ) {
    scripts['diagnostics:backend'] =
      'node scripts/diagnostics-remote-backend.mjs';
    if (config.capabilities.diagnostics.options.mcp)
      scripts['diagnostics:remote-mcp'] =
        'node scripts/diagnostics-remote-mcp.mjs';
  }
  return file(
    'package.json',
    json({
      name: config.project.name,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: 'npm@11.20.0',
      engines: { node: '>=26.13.1 <27' },
      scripts,
      dependencies: sorted(dependencies),
      devDependencies: sorted(devDependencies),
    }),
  );
}

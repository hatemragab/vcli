import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import type { ProjectConfig } from '../src/contracts.js';
import { recipeCatalog, renderScaffold } from '../dist/recipes/index.js';
import { linkGeneratedDependencies } from './generated-dependencies.ts';

// Compile each generated profile against the repository's locked test dependencies.
const profiles = [
  ...(['mongodb', 'postgres'] as const).flatMap((database) =>
    (['local', 'firebase'] as const).map((auth) => ({
      database,
      auth,
      storage: 'aws-s3',
      realtime: 'native-ws',
    })),
  ),
  ...(['mongodb', 'postgres'] as const).map((database) => ({
    database,
    auth: 'local',
    profile: 'basic',
    storage: 'local',
    realtime: 'none',
    mail: 'none',
  })),
  {
    database: 'mongodb',
    auth: 'firebase',
    storage: 'local',
    realtime: 'socket-io',
  },
  {
    database: 'postgres',
    auth: 'local',
    storage: 'r2',
    realtime: 'centrifugo',
    mail: 'smtp',
  },
  {
    database: 'none',
    auth: 'none',
    storage: 'none',
    realtime: 'none',
    mail: 'none',
  },
  {
    database: 'none',
    auth: 'none',
    storage: 'none',
    realtime: 'none',
    mail: 'capture',
  },
];
for (const profile of profiles) {
  const { database, auth, storage, realtime } = profile;
  const basic = 'profile' in profile && profile.profile === 'basic';
  const mail = 'mail' in profile ? profile.mail : 'smtp';
  test(`noEmit/lint/architecture generated ${database}/${basic ? 'local-basic' : auth}/${storage}/${realtime}/${mail}`, async () => {
    const ids = [
      'foundation.nest',
      ...(database === 'none' ? [] : [`database.${database}`, `auth.${auth}`]),
      ...(mail === 'none' ? [] : [`mail.${mail}`]),
      ...(storage === 'none'
        ? []
        : [
            `storage.${storage}`,
            ...(basic
              ? []
              : [
                  'media.private',
                  'push.fcm',
                  'push.apns',
                  `realtime.${realtime}`,
                ]),
            'diagnostics.local',
            'deployment.dokploy',
          ]),
    ];
    const config: ProjectConfig = {
      schemaVersion: 1,
      project: { name: 'compile-api', packageManager: 'npm' },
      capabilities: {},
    };
    const resolved = ids.map((id) =>
      recipeCatalog.recipes.find((r) => r.id === id)!,
    );
    for (const recipe of resolved)
      config.capabilities[recipe.family] = {
        recipe: recipe.id,
        options:
          recipe.id === 'diagnostics.local'
            ? { mcp: true, vector: true, logdy: true }
            : basic && recipe.id === 'auth.local'
              ? { profile: 'basic' }
              : {},
      };
    const rendered = await recipeCatalog.render(config, resolved);
    if (basic) {
      const files = new Map(
        rendered.files.map((file) => [file.path, file.content]),
      );
      assert.match(
        files.get('ops/Dockerfile') ?? '',
        /test ! -L node_modules\/@vcli\/auth-runtime/,
      );
      assert.match(
        files.get('src/generated/selected-seeders.ts') ?? '',
        /requiresIdentitySchema = false/,
      );
      assert.equal(
        [...files.keys()].some((path) =>
          /^src\/modules\/(identity|installations|sessions|mail)\//.test(path),
        ),
        false,
      );
      const manifest = JSON.parse(files.get('package.json')!) as {
        dependencies: Record<string, string>;
      };
      assert.ok(manifest.dependencies['@redis/client']);
      assert.ok(manifest.dependencies['@vcli/auth-runtime']);
      assert.equal(manifest.dependencies.nodemailer, undefined);
    }
    rendered.files.push(
      ...(
        await renderScaffold(config, {
          kind: 'feature',
          name: 'project-item',
        })
      ).files,
    );
    const source = rendered.files.filter((file) =>
      /^src\/.*\.ts$/.test(file.path),
    );
    for (const file of source) {
      assert.doesNotMatch(
        file.content,
        /\b(?:DynamicModule|ConfiguredCapabilities)\b/,
        file.path,
      );
    }
    assert.match(
      source.find((file) => file.path === 'src/create-app.ts')?.content ?? '',
      /NestFactory\.create\(AppModule,/,
    );
    const directory = await mkdtemp(join(tmpdir(), 'vcli-recipes-compile-'));
    try {
      for (const file of rendered.files) {
        const target = join(directory, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      await linkGeneratedDependencies(directory);
      const architecture: {
        checkArchitecture(path: string): Promise<{ failures: string[] }>;
      } = await import(
        pathToFileURL(join(directory, 'scripts/architecture-rules.ts')).href
      );
      assert.deepEqual(
        (await architecture.checkArchitecture(join(directory, 'src'))).failures,
        [],
      );
      const lint = spawnSync(
        process.execPath,
        [resolve('node_modules/eslint/bin/eslint.js'), 'src'],
        { cwd: directory, encoding: 'utf8' },
      );
      assert.equal(lint.status, 0, lint.stdout + lint.stderr);
      const configPath = join(directory, 'tsconfig.json');
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      assert.equal(read.error, undefined);
      const options = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        directory,
        { noEmit: true },
        configPath,
      );
      const program = ts.createProgram(options.fileNames, options.options);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n',
      });
      assert.equal(diagnostics.length, 0, formatted);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProjectConfig, RenderedFile } from '../src/contracts.js';
import { linkGeneratedDependencies } from './generated-dependencies.ts';
import { pushFixture, pushFixtureRoot } from './push-lifecycle-fixture.ts';

test('six selected push closures: real renderer, strict ES2023 noEmit, lint and architecture with cached dependencies', async () => {
  const tooling = `${pushFixtureRoot}/tooling`;
  await mkdir(tooling, { recursive: true });
  await writeFile(`${tooling}/package.json`, '{"type":"module"}\n');
  for (const name of ['node_modules', 'templates']) {
    try {
      await symlink(resolve(name), `${tooling}/${name}`, 'dir');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const compiler = spawnSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--types',
      'node',
      '--target',
      'ES2023',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--strict',
      '--skipLibCheck',
      '--esModuleInterop',
      '--rootDir',
      'src',
      '--outDir',
      `${tooling}/dist`,
      'src/recipes/render-push.ts',
      'src/recipes/render-config.ts',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr);
  const { pushFiles } = (await import(
    pathToFileURL(`${tooling}/dist/recipes/render-push.js`).href
  )) as { pushFiles(config: ProjectConfig): Promise<RenderedFile[]> };
  const { configuration } = (await import(
    pathToFileURL(`${tooling}/dist/recipes/render-config.js`).href
  )) as { configuration(config: ProjectConfig): { files: RenderedFile[] } };
  const { checkArchitecture } = (await import(
    pathToFileURL(
      resolve('templates/runtime/common/scripts/architecture-rules.ts'),
    ).href
  )) as { checkArchitecture(path: string): Promise<{ failures: string[] }> };
  for (const database of ['mongodb', 'postgres'] as const) {
    await pushFixture(database);
    for (const selected of [
      ['push.fcm'],
      ['push.apns'],
      ['push.fcm', 'push.apns'],
    ]) {
      const config: ProjectConfig = {
        schemaVersion: 1,
        project: { name: 'selected-push', packageManager: 'npm' },
        capabilities: {
          database: { recipe: `database.${database}`, options: {} },
          auth: { recipe: 'auth.local', options: {} },
          ...Object.fromEntries(
            selected.map((recipe) => [
              recipe === 'push.fcm' ? 'push-fcm' : 'push-apns',
              { recipe, options: {} },
            ]),
          ),
        },
      };
      const files = await pushFiles(config);
      const readme = files.find(
        (file) => file.path === 'ops/push/README.md',
      )!.content;
      const fcm = selected.includes('push.fcm');
      const apns = selected.includes('push.apns');
      assert.ok(
        readme.includes(`Ordinary push routes to ${fcm ? 'FCM' : 'APNs'}.`),
      );
      assert.equal(readme.includes('Firebase Admin SDK'), fcm);
      assert.equal(readme.includes('TrustedCallInvitationPolicy'), apns);
      const root = `${pushFixtureRoot}/selected-${database}-${selected.join('-')}`;
      await rm(`${root}/src`, { recursive: true, force: true });
      await mkdir(root, { recursive: true });
      await cp(`${pushFixtureRoot}/${database}/src/core`, `${root}/src/core`, {
        recursive: true,
      });
      await cp(
        `${pushFixtureRoot}/${database}/tsconfig.json`,
        `${root}/tsconfig.json`,
      );
      await writeFile(`${root}/package.json`, '{"type":"module"}\n');
      await linkGeneratedDependencies(root);
      for (const file of [
        ...files,
        ...configuration(config).files.filter((f) => f.path.startsWith('src/')),
      ]) {
        await mkdir(dirname(`${root}/${file.path}`), { recursive: true });
        await writeFile(`${root}/${file.path}`, file.content);
      }
      for (const [path, expected] of [
        ['fcm-push.service.ts', selected.includes('push.fcm')],
        ['apns-push.service.ts', selected.includes('push.apns')],
        ['mongo-push-state-store.ts', database === 'mongodb'],
        ['postgres-push-state-store.ts', database === 'postgres'],
      ] as const)
        assert.equal(
          files.some((f) => f.path === `src/modules/push/${path}`),
          expected,
        );
      const module = await readFile(
        `${root}/src/modules/push/push.module.ts`,
        'utf8',
      );
      assert.equal(
        module.includes('fcmCredential'),
        selected.includes('push.fcm'),
      );
      assert.match(module, /voipPolicy:dependencies.voipPolicy/);
      const noEmit = spawnSync(
        process.execPath,
        [
          resolve('node_modules/typescript/bin/tsc'),
          '-p',
          `${root}/tsconfig.json`,
          '--noEmit',
        ],
        { encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(
        noEmit.status,
        0,
        `${root}: ${noEmit.stdout}${noEmit.stderr}`,
      );
      const lint = spawnSync(
        process.execPath,
        [resolve('node_modules/eslint/bin/eslint.js'), `${root}/src`],
        { encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(lint.status, 0, `${root}: ${lint.stdout}${lint.stderr}`);
      assert.deepEqual((await checkArchitecture(root)).failures, []);
    }
  }
});

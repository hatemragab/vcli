import assert from 'node:assert/strict';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import {
  contents,
  generatedIdentityProject,
  identitySelection,
} from './identity-rendering-fixture.ts';

for (const database of ['mongodb', 'postgres'] as const) {
  for (const profile of [
    { auth: 'local' as const, mode: 'immediate' as const },
    { auth: 'local' as const, mode: 'reliable' as const },
    { auth: 'firebase' as const, mode: 'provider' as const },
    { auth: 'firebase' as const, mode: 'application' as const },
  ]) {
    test(`complete generated noEmit/lint/architecture ${database}/${profile.auth}/${profile.mode}`, async () => {
      const selected = identitySelection(database, profile.auth, profile.mode);
      if (profile.auth === 'firebase' && profile.mode === 'provider')
        selected.capabilities.diagnostics = {
          recipe: 'diagnostics.local',
          options: { sources: ['application', 'database'] },
        };
      const project = await generatedIdentityProject(selected);
      const directory = resolve(
        'var/cli-identity-integration',
        'full-' + database + '-' + profile.auth + '-' + profile.mode,
      );
      await rm(join(directory, 'src'), { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
      for (const file of project.files) {
        const path = join(directory, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content);
      }
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
      const configPath = join(directory, 'tsconfig.json'),
        read = ts.readConfigFile(configPath, ts.sys.readFile);
      assert.equal(read.error, undefined);
      const options = ts.parseJsonConfigFileContent(
          read.config,
          ts.sys,
          directory,
          { noEmit: true },
          configPath,
        ),
        program = ts.createProgram(options.fileNames, options.options),
        diagnostics = ts.getPreEmitDiagnostics(program);
      assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (file) => file,
          getCurrentDirectory: () => directory,
          getNewLine: () => '\n',
        }),
      );
      const architecture: {
        checkArchitecture(
          root: string,
        ): Promise<{ failures: readonly string[] }>;
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
        { cwd: directory, encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(lint.status, 0, lint.stdout + lint.stderr);
      assert.equal(
        project.files.filter(
          (file) => file.path === 'src/initialize-database.ts',
        ).length,
        1,
      );
      const module = contents(
          project.files,
          'src/modules/identity/identity.module.ts',
        ),
        initialization = contents(project.files, 'src/initialize-database.ts');
      assert.match(initialization, /initializeSelectedSchemas/);
      const owners = contents(
        project.files,
        'src/generated/initialize-selected-schemas.ts',
      );
      assert.match(owners, /initializeIdentityDatabase/);
      if (profile.auth === 'firebase' && profile.mode === 'provider') {
        assert.match(
          contents(project.files, 'src/create-app.ts'),
          /openDatabase\(config, true, databaseDiagnostics\)/,
        );
        assert.equal(
          project.files.some(
            (file) => file.path === 'src/modules/mail/mail.module.ts',
          ),
          false,
        );
        assert.equal(
          /MailSubmitter|ActionDeliveryWriter|FirebaseActionLinksService/.test(
            module,
          ),
          false,
        );
      }
      if (profile.mode === 'reliable' || profile.mode === 'application')
        assert.match(owners, /initializeMail/);
    });
  }
}

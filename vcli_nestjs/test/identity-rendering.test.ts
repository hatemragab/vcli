import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  contents,
  identityRenderer,
  identitySelection,
  selectedIdentityFixture,
} from './identity-rendering-fixture.ts';

const combinations = (['mongodb', 'postgres'] as const).flatMap((database) => [
  { database, auth: 'local' as const, mode: 'immediate' as const },
  { database, auth: 'local' as const, mode: 'reliable' as const },
  { database, auth: 'firebase' as const, mode: 'provider' as const },
  { database, auth: 'firebase' as const, mode: 'application' as const },
]);
for (const { database, auth, mode } of combinations) {
  test(`selected identity manifest and noEmit ${database}/${auth}/${mode}`, async () => {
    const fixture = await selectedIdentityFixture(database, auth, mode),
      files = fixture.files,
      paths = files.map((file) => file.path);
    assert.equal(new Set(paths).size, paths.length);
    assert.equal(
      paths.includes('src/initialize-database.ts'),
      false,
      'root alone composes cross-owner schema entrypoint',
    );
    for (const helper of [
      'password-input',
      'auth-runtime-error',
      'session-record',
    ])
      assert.ok(paths.includes('src/core/auth/' + helper + '.ts'));
    for (const name of [
      'fresh-identity-proof.service',
      'account-lifecycle.service',
      'self-account.controller',
      'installation-lifecycle.service',
      'installation-lifecycle.controller',
      'provider-cleanup.entity',
      'provider-cleanup.service',
    ])
      assert.ok(paths.includes('src/modules/identity/' + name + '.ts'));
    assert.ok(paths.includes('clients/auth-' + auth + '.mjs'));
    assert.equal(
      paths.includes(
        'clients/auth-' + (auth === 'local' ? 'firebase' : 'local') + '.mjs',
      ),
      false,
    );
    assert.equal(
      paths.some((path) =>
        path.includes(database === 'mongodb' ? 'postgres' : 'mongodb'),
      ),
      false,
    );
    assert.equal(
      files.some((file) =>
        /examples\/reference|\/home\/orca|RepositoryAdapter/.test(file.content),
      ),
      false,
    );
    const module = contents(files, 'src/modules/identity/identity.module.ts');
    assert.match(module, /provide:FreshIdentityProof/);
    assert.match(module, /provide:AccountLifecycle/);
    assert.match(module, /provide:InstallationLifecycle/);
    assert.match(
      module,
      /SelfAccountController,InstallationLifecycleController/,
    );
    assert.equal(
      files.some((file) => file.path.startsWith('src/modules/mail/')),
      false,
      'mail renderer owns mail implementation',
    );
    if (auth === 'local') {
      assert.match(module, /new JoseAccessTokens\(config.auth.jwtPolicy\)/);
      assert.equal(
        /JWT_SECRET|jwtSecret|firebase-admin/.test(
          files.map((file) => file.content).join('\n'),
        ),
        false,
      );
      assert.equal(
        paths.some((path) =>
          path.endsWith('/firebase-token-verifier.service.ts'),
        ),
        false,
      );
      assert.equal(
        paths.some((path) => path.endsWith('/provider-links.service.ts')),
        false,
      );
      assert.equal(
        module.includes('config.mailDelivery.maxLifetimeMs'),
        mode === 'reliable',
      );
      assert.equal(
        module.includes(
          'new ActionTokens(db,accounts,identities,sessions,passwords,mail,delivery',
        ),
        mode === 'reliable',
      );
    } else {
      assert.match(
        contents(files, 'src/modules/identity/identity-inputs.ts'),
        /sessionCapability: secret/,
      );
      assert.match(
        contents(files, 'src/modules/identity/identity-inputs.ts'),
        /installationCapability: secret/,
      );
      assert.equal(
        paths.some(
          (path) =>
            path.endsWith('/argon-passwords.service.ts') ||
            path.endsWith('/jose-access-tokens.service.ts'),
        ),
        false,
      );
      assert.equal(
        files.some((file) =>
          /from ['"](?:argon2|jose|@vcli\/auth-runtime\/(?:password|jwt))['"]/.test(
            file.content,
          ),
        ),
        false,
      );
      assert.match(
        module,
        /dependencies\.firebase\?\?new FirebaseTokenVerifier/,
      );
      assert.match(module, /cleanup:ProviderCleanupDispatcher/);
      assert.match(module, /ProviderLinksController/);
      assert.equal(
        module.includes('FirebaseActionLinksService'),
        mode === 'application',
      );
      assert.equal(
        module.includes('config.firebaseActions'),
        mode === 'application',
      );
      assert.equal(module.includes('config.mailDelivery'), false);
      assert.equal(
        paths.includes('src/modules/identity/firebase-actions.controller.ts'),
        mode === 'application',
      );
    }
    if (database === 'postgres') {
      assert.ok(paths.includes('migrations/001-identity.sql'));
      assert.ok(paths.includes('migrations/002-identity-lifecycle.sql'));
    } else
      for (const owner of [
        'identity/identity',
        'installations/installation',
        'sessions/session',
      ])
        assert.ok(
          paths.includes('src/modules/' + owner + '-lifecycle-migration.ts'),
        );
  });
}

test('identity rendering is deterministic and retains native source ownership', async () => {
  const { identityFiles } = await identityRenderer(),
    selection = identitySelection('postgres', 'firebase', 'provider');
  assert.deepEqual(
    await identityFiles(selection),
    await identityFiles(selection),
  );
  const files = await identityFiles(selection);
  assert.equal(
    files.find(
      (file) => file.path === 'src/modules/identity/identity.module.ts',
    )?.ownership,
    'managed',
  );
  assert.equal(
    files.find(
      (file) => file.path === 'src/modules/identity/provider-links.service.ts',
    )?.ownership,
    'scaffold',
  );
  assert.equal(
    contents(
      files,
      'src/modules/identity/firebase-identity.controller.ts',
    ).includes('      sessionToken,'),
    false,
  );
});

test('ordinary database open validates both identity markers and never initializes production schemas', async () => {
  for (const database of ['mongodb', 'postgres']) {
    const source = await readFile(
      `templates/runtime/${database}/src/core/database/${database === 'postgres' ? 'postgres' : 'mongo'}-database.ts`,
      'utf8',
    );
    assert.ok(source.includes('identity-v1'));
    assert.ok(source.includes('identity-lifecycle-v2'));
    assert.equal(
      /initializeIdentity|migrateIdentity|CREATE TABLE|createCollection/.test(
        source,
      ),
      false,
    );
  }
});

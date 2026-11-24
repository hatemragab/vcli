import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { selectedIdentityFixture } from './identity-rendering-fixture.ts';

function config(application = false) {
  return {
    publicOrigin: 'https://app.example.invalid',
    auth: {
      firebaseProjectId: 'synthetic-project',
      firebaseMethods: ['google.com', 'phone'],
      recentAuthSeconds: 300,
      sessionTtlSeconds: 86400,
    },
    ...(application
      ? {
          firebaseActions: {
            policy: { continueOrigins: ['https://app.example.invalid'] },
            continueUrl: 'https://app.example.invalid/action',
            applicationName: 'Isolated test',
            deliveryLifetimeMs: 900000,
          },
        }
      : {}),
  };
}
function syntheticFirebase(application = false) {
  let closed = 0,
    actionAuth = 0;
  const provider = {
    async verify() {
      throw new Error('UNUSED_CONTROLLED_VERIFIER');
    },
    async assertCurrent() {
      throw new Error('UNUSED_CONTROLLED_AUTHORITY');
    },
    async cleanup() {
      throw new Error('UNUSED_CONTROLLED_CLEANUP');
    },
    async close() {
      closed++;
    },
    ...(application
      ? {
          actionLinksAuth() {
            actionAuth++;
            return {
              async generateEmailVerificationLink() {
                throw new Error('UNUSED_CONTROLLED_ACTION');
              },
              async generatePasswordResetLink() {
                throw new Error('UNUSED_CONTROLLED_ACTION');
              },
            };
          },
        }
      : {}),
  };
  return { provider, closed: () => closed, actionAuth: () => actionAuth };
}

for (const mode of ['provider', 'application'] as const) {
  test(`generated Firebase ${mode} factory uses only trusted supplied provider and closes it once`, async () => {
    const fixture = await selectedIdentityFixture('postgres', 'firebase', mode);
    fixture.emit();
    const { createIdentityRuntime } = await fixture.load(
      'modules/identity/identity.module',
    );
    const fake = syntheticFirebase(mode === 'application');
    const delivery = {
      prepare() {
        throw new Error('UNUSED_CONTROLLED_DELIVERY');
      },
      async stage() {
        throw new Error('UNUSED_CONTROLLED_STAGE');
      },
    };
    const runtime =
      mode === 'application'
        ? await createIdentityRuntime(config(true), {}, delivery, {
            firebase: fake.provider,
          })
        : await createIdentityRuntime(
            config(),
            {},
            { firebase: fake.provider },
          );
    assert.equal(typeof runtime.authority.verify, 'function');
    assert.equal(typeof runtime.cleanup.drain, 'function');
    const controllers = runtime.module.controllers.map(
      (controller: { name: string }) => controller.name,
    );
    assert.ok(controllers.includes('SelfAccountController'));
    assert.ok(controllers.includes('InstallationLifecycleController'));
    assert.ok(controllers.includes('ProviderLinksController'));
    assert.equal(
      controllers.includes('FirebaseActionsController'),
      mode === 'application',
    );
    assert.ok(
      runtime.module.providers.some(
        (provider: { useValue?: unknown }) =>
          provider.useValue === fake.provider,
      ),
    );
    assert.equal(fake.actionAuth(), mode === 'application' ? 1 : 0);
    await Promise.all([runtime.close(), runtime.close()]);
    assert.equal(fake.closed(), 1);
  });
}

test('a custom module importing configured identity can inject the principal guard', async () => {
  const fixture = await selectedIdentityFixture(
    'postgres',
    'firebase',
    'provider',
  );
  fixture.emit();
  const { createIdentityRuntime } = await fixture.load(
    'modules/identity/identity.module',
  );
  const { PrincipalGuard } = await fixture.load('core/http/principal.guard');
  const { NestFactory } = await import(
    pathToFileURL(join(fixture.directory, 'node_modules/@nestjs/core/index.js'))
      .href
  );
  const runtime = await createIdentityRuntime(
    config(),
    {},
    { firebase: syntheticFirebase().provider },
  );
  class OrdersModule {}
  try {
    const app = await NestFactory.createApplicationContext(
      {
        module: OrdersModule,
        imports: [runtime.module],
        providers: [{ provide: 'ORDERS_GUARD', useExisting: PrincipalGuard }],
      },
      { logger: false, abortOnError: false },
    );
    try {
      const guard = app.get('ORDERS_GUARD');
      assert.ok(guard instanceof PrincipalGuard);
      const anonymousRequest = {
        switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
      };
      await assert.rejects(guard.canActivate(anonymousRequest), {
        code: 'UNAUTHENTICATED',
        status: 401,
      });
    } finally {
      await app.close();
    }
  } finally {
    await runtime.close();
  }
});

test('generated application factory closes the injected provider after composition failure', async () => {
  const fixture = await selectedIdentityFixture(
    'postgres',
    'firebase',
    'application',
  );
  fixture.emit();
  const { createIdentityRuntime } = await fixture.load(
      'modules/identity/identity.module',
    ),
    fake = syntheticFirebase(true),
    invalid = config(true);
  invalid.firebaseActions!.policy.continueOrigins = [];
  await assert.rejects(
    createIdentityRuntime(
      invalid,
      {},
      {
        prepare() {
          throw new Error('UNUSED');
        },
        async stage() {},
      },
      { firebase: fake.provider },
    ),
    { code: 'INVALID_FIREBASE_ACTION_POLICY' },
  );
  assert.equal(fake.closed(), 1);
});

test('generated local factory enforces selected immediate/reliable writer semantics and the exact JWT policy', async () => {
  const options = {
    publicOrigin: 'https://app.example.invalid',
    auth: {
      jwtPolicy: {
        issuer: 'issuer',
        audience: 'audience',
        activeSigningKeyId: 'active',
        keys: [{ id: 'active', key: randomBytes(32) }],
      },
      sessionTtlSeconds: 86400,
      recentAuthSeconds: 300,
      accessTtlSeconds: 300,
    },
    mailDelivery: { maxLifetimeMs: 900000 },
  };
  const sender = {
      async submit() {
        throw new Error('UNUSED_CONTROLLED_SENDER');
      },
    },
    delivery = {
      prepare() {
        throw new Error('UNUSED_CONTROLLED_PREPARE');
      },
      async stage() {
        throw new Error('UNUSED_CONTROLLED_STAGE');
      },
    };
  for (const mode of ['immediate', 'reliable'] as const) {
    const fixture = await selectedIdentityFixture('postgres', 'local', mode);
    fixture.emit();
    const { createIdentityRuntime } = await fixture.load(
      'modules/identity/identity.module',
    );
    if (mode === 'immediate')
      await assert.rejects(
        createIdentityRuntime(options, {}, sender, delivery),
        { code: 'UNSELECTED_RELIABLE_ACTION_DELIVERY' },
      );
    else
      await assert.rejects(createIdentityRuntime(options, {}, sender), {
        code: 'RELIABLE_ACTION_DELIVERY_REQUIRED',
      });
    const runtime = await createIdentityRuntime(
      options,
      {},
      sender,
      mode === 'reliable' ? delivery : undefined,
    );
    const controllers = runtime.module.controllers.map(
      (controller: { name: string }) => controller.name,
    );
    assert.ok(controllers.includes('LocalIdentityController'));
    assert.equal(controllers.includes('FirebaseIdentityController'), false);
    await runtime.close();
  }
});

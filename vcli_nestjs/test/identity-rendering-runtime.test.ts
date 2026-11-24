import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import {
  Module,
  type INestApplicationContext,
  type Type,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';
import type { BootstrapBinding } from '../templates/runtime/common/src/core/bootstrap/bootstrap-bindings.ts';
import { selectedIdentityFixture } from './identity-rendering-fixture.ts';

function config(application = false) {
  return {
    publicOrigin: 'https://app.example.invalid',
    auth: {
      firebaseProjectId: 'synthetic-project',
      firebaseMethods: ['google.com', 'phone'],
      rateLimitRedisUrl: 'redis://127.0.0.1:6379',
      rateLimitNamespace: 'identity-rendering:test',
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

function controllerNames(entry: Type<unknown>) {
  const controllers: readonly Type<unknown>[] = Reflect.getMetadata(
    MODULE_METADATA.CONTROLLERS,
    entry,
  );
  return controllers.map((controller) => controller.name);
}

async function withIdentityContext<T>(
  fixture: Awaited<ReturnType<typeof selectedIdentityFixture>>,
  entry: Type<unknown>,
  db: object,
  bindings: readonly BootstrapBinding[],
  run: (app: INestApplicationContext) => Promise<T> | T,
): Promise<T> {
  const { withBootstrapBindings } = await fixture.load(
    'core/bootstrap/bootstrap-bindings',
  );
  const { bindDatabase } = await fixture.load('core/database/database.module');
  const app: INestApplicationContext = await withBootstrapBindings(
    [bindDatabase(db), ...bindings],
    () =>
      NestFactory.createApplicationContext(entry, {
        logger: false,
        abortOnError: false,
      }),
  );
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

for (const mode of ['provider', 'application'] as const) {
  test(`generated Firebase ${mode} factory uses only trusted supplied provider and closes it once`, async () => {
    const fixture = await selectedIdentityFixture('postgres', 'firebase', mode);
    fixture.emit();
    const { IdentityModule, createIdentityRuntime } = await fixture.load(
      'modules/identity/identity.module',
    );
    const { IdentityRateLimits } = await fixture.load(
      'modules/identity/identity-rate-limits.service',
    );
    const { FIREBASE_VERIFIER } = await fixture.load(
      'modules/identity/firebase-identity.controller',
    );
    const db = {};
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
        ? await createIdentityRuntime(config(true), db, delivery, {
            firebase: fake.provider,
          })
        : await createIdentityRuntime(config(), db, {
            firebase: fake.provider,
          });
    assert.equal(typeof runtime.authority.verify, 'function');
    assert.equal(typeof runtime.cleanup.drain, 'function');
    const controllers = controllerNames(IdentityModule);
    assert.ok(controllers.includes('SelfAccountController'));
    assert.ok(controllers.includes('InstallationLifecycleController'));
    assert.ok(controllers.includes('ProviderLinksController'));
    assert.equal(
      controllers.includes('FirebaseActionsController'),
      mode === 'application',
    );
    assert.equal(fake.actionAuth(), mode === 'application' ? 1 : 0);
    const limiter = await withIdentityContext(
      fixture,
      IdentityModule,
      db,
      runtime.bindings,
      (app) => {
        assert.equal(app.get(FIREBASE_VERIFIER), fake.provider);
        return app.get(IdentityRateLimits);
      },
    );
    assert.ok(limiter);
    await Promise.all([runtime.close(), runtime.close()]);
    assert.equal(fake.closed(), 1);
    await assert.rejects(
      limiter.spend([{ key: 'synthetic-scope', limit: 1 }]),
      {
        code: 'IDENTITY_RATE_UNAVAILABLE',
        status: 503,
      },
    );
  });
}

test('a custom module importing IdentityModule can inject the principal guard', async () => {
  const fixture = await selectedIdentityFixture(
    'postgres',
    'firebase',
    'provider',
  );
  fixture.emit();
  const { IdentityModule, createIdentityRuntime } = await fixture.load(
    'modules/identity/identity.module',
  );
  const { PrincipalGuard } = await fixture.load('core/http/principal.guard');
  const db = {};
  const runtime = await createIdentityRuntime(config(), db, {
    firebase: syntheticFirebase().provider,
  });
  class OrdersModule {}
  Module({
    imports: [IdentityModule],
    providers: [{ provide: 'ORDERS_GUARD', useExisting: PrincipalGuard }],
  })(OrdersModule);
  try {
    await withIdentityContext(
      fixture,
      OrdersModule,
      db,
      runtime.bindings,
      async (app) => {
        const guard = app.get('ORDERS_GUARD');
        assert.ok(guard instanceof PrincipalGuard);
        const anonymousRequest = {
          switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
        };
        await assert.rejects(guard.canActivate(anonymousRequest), {
          code: 'UNAUTHENTICATED',
          status: 401,
        });
      },
    );
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
      rateLimitRedisUrl: 'redis://127.0.0.1:6379',
      rateLimitNamespace: 'identity-rendering:test',
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
    const { IdentityModule, createIdentityRuntime } = await fixture.load(
      'modules/identity/identity.module',
    );
    const { IdentityRateLimits } = await fixture.load(
      'modules/identity/identity-rate-limits.service',
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
    const db = {};
    const runtime = await createIdentityRuntime(
      options,
      db,
      sender,
      mode === 'reliable' ? delivery : undefined,
    );
    const controllers = controllerNames(IdentityModule);
    assert.ok(controllers.includes('LocalIdentityController'));
    assert.equal(controllers.includes('FirebaseIdentityController'), false);
    const limiter = await withIdentityContext(
      fixture,
      IdentityModule,
      db,
      runtime.bindings,
      (app) => app.get(IdentityRateLimits),
    );
    assert.ok(limiter);
    await runtime.close();
    await assert.rejects(
      limiter.spend([{ key: 'synthetic-scope', limit: 1 }]),
      {
        code: 'IDENTITY_RATE_UNAVAILABLE',
        status: 503,
      },
    );
  }
});

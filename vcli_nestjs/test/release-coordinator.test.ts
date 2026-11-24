import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ReleaseManifest,
  ReleaseOwner,
} from '../templates/runtime/common/src/release/release-types.js';
import { ControlledReleaseStore } from './release-memory-store.ts';
import {
  releaseFixture,
  releaseRenderers,
  compileReleaseCommands,
} from './release-fixture.ts';
const manifest: ReleaseManifest = {
  schema: 1,
  id: 'release-proof-v1',
  components: [
    { component: 'identity', version: 1, digest: 'a'.repeat(64) },
    { component: 'mail', version: 1, digest: 'b'.repeat(64) },
  ],
};
type Coordinator =
  typeof import('../templates/runtime/common/src/release/release-coordinator.js');
type Validation =
  typeof import('../templates/runtime/common/src/release/release-validation.js');

test('controlled ledger: partial failure preserves earlier success, blocks retries, requires exact quiesced reconciliation', async () => {
  const load = await releaseFixture('postgres'),
    { ReleaseCoordinator } = await load<Coordinator>('release-coordinator'),
    { assertLedgerReady } = await load<Validation>('release-validation');
  const store = new ControlledReleaseStore(),
    coordinator = new ReleaseCoordinator(store);
  let first = 0,
    second = 0,
    fail = true;
  const owners: ReleaseOwner[] = [
    {
      component: 'identity',
      apply: async () => {
        first++;
      },
    },
    {
      component: 'mail',
      apply: async () => {
        second++;
        if (fail) throw new Error('controlled partial DDL');
      },
    },
  ];
  assert.throws(() => assertLedgerReady(null, manifest), /NOT_READY/);
  await assert.rejects(coordinator.apply(manifest, owners), /OUTCOME_UNKNOWN/);
  assert.equal(first, 1);
  assert.equal(store.ledger.attempts[0]?.status, 'completed');
  assert.equal(store.ledger.attempts[1]?.status, 'unknown');
  await assert.rejects(
    coordinator.apply(manifest, owners),
    /RECONCILIATION_REQUIRED/,
  );
  assert.equal(second, 1);
  await assert.rejects(
    coordinator.reconcile(manifest, {
      quiesced: true,
      expectedHolder: null,
      expectedFence: 0,
      evidence: 'ticket:proof',
      attemptId: store.ledger.attempts[1]!.id,
      decision: 'retry',
    }),
    /STALE/,
  );
  fail = false;
  await coordinator.reconcile(manifest, {
    quiesced: true,
    expectedHolder: null,
    expectedFence: store.ledger.fence,
    evidence: 'ticket:inspected-stopped',
    attemptId: store.ledger.attempts[1]!.id,
    decision: 'retry',
  });
  await coordinator.apply(manifest, owners);
  await coordinator.apply(manifest, owners);
  assert.equal(first, 1);
  assert.equal(second, 2);
  assert.equal(store.ledger.attempts.length, 3);
  assertLedgerReady(store.ledger, manifest);
});

for (const loss of ['before', 'after'] as const)
  test(`controlled acknowledgement loss ${loss}: no blind duplicate`, async () => {
    const load = await releaseFixture('postgres'),
      { ReleaseCoordinator } = await load<Coordinator>('release-coordinator');
    const store = new ControlledReleaseStore(),
      coordinator = new ReleaseCoordinator(store);
    store.loseCompletion = loss;
    let calls = 0;
    const plan = { ...manifest, components: manifest.components.slice(0, 1) },
      owners = [
        {
          component: 'identity',
          apply: async () => {
            calls++;
          },
        },
      ];
    await assert.rejects(coordinator.apply(plan, owners), /OUTCOME_UNKNOWN/);
    if (loss === 'before')
      await assert.rejects(coordinator.apply(plan, owners), /RECONCILIATION/);
    else await coordinator.apply(plan, owners);
    assert.equal(calls, 1);
  });

test('controlled concurrency, stale plans, digest drift, owner registration and orphan fencing', async () => {
  const load = await releaseFixture('postgres'),
    { ReleaseCoordinator } = await load<Coordinator>('release-coordinator'),
    { assertLedgerReady } = await load<Validation>('release-validation');
  const store = new ControlledReleaseStore(),
    coordinator = new ReleaseCoordinator(store);
  let resume = () => {};
  const hold = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let started = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const plan = { ...manifest, components: manifest.components.slice(0, 1) },
    owners = [
      {
        component: 'identity',
        apply: async () => {
          started();
          await hold;
        },
      },
    ];
  const running = coordinator.apply(plan, owners);
  await ready;
  await assert.rejects(
    new ReleaseCoordinator(store).apply(plan, owners),
    /BUSY/,
  );
  assert.throws(() => assertLedgerReady(store.ledger, plan), /NOT_READY/);
  resume();
  await running;
  await assert.rejects(
    coordinator.apply(
      {
        ...plan,
        components: [{ ...plan.components[0]!, digest: 'c'.repeat(64) }],
      },
      owners,
    ),
    /IDENTITY_MISMATCH/,
  );
  await assert.rejects(
    coordinator.apply(
      {
        ...plan,
        id: 'release-mutated',
        components: [{ ...plan.components[0]!, digest: 'c'.repeat(64) }],
      },
      owners,
    ),
    /DIGEST_MISMATCH/,
  );
  await assert.rejects(coordinator.apply(plan, []), /OWNER_SET/);
  const identifiedNext = { ...plan, id: 'release-next-same-components' };
  await coordinator.apply(identifiedNext, [
    {
      component: 'identity',
      apply: async () => {
        throw new Error('completed owner must remain skipped');
      },
    },
  ]);
  await assert.rejects(coordinator.apply(plan, owners), /STALE/);
  assert.throws(() => assertLedgerReady(store.ledger, plan), /NOT_READY/);
  assertLedgerReady(store.ledger, identifiedNext);
  await coordinator.apply(
    {
      ...plan,
      id: 'release-proof-v2',
      components: [{ ...plan.components[0]!, version: 2 }],
    },
    [{ component: 'identity', apply: async () => {} }],
  );
  await assert.rejects(coordinator.apply(plan, owners), /STALE/);
  assert.throws(() => assertLedgerReady(store.ledger, plan), /NOT_READY/);
  const abandoned = await store.acquire();
  await store.close();
  await assert.rejects(coordinator.apply(plan, owners), /BUSY/);
  const current = {
    ...plan,
    id: 'release-proof-v2',
    components: [{ ...plan.components[0]!, version: 2 }],
  };
  await coordinator.reconcile(current, {
    quiesced: true,
    expectedHolder: abandoned.token,
    expectedFence: abandoned.fence,
    evidence: 'ticket:all-runners-stopped',
  });
  await assert.rejects(
    store.change(abandoned, () => {}),
    /FENCE_LOST/,
  );
});

test('selected renderer: finite versioned native owner manifests, optional realtime seam, command closure', async () => {
  const { schema, release, configuration } = await releaseRenderers();
  assert.deepEqual(
    schema.schemaFiles({
      schemaVersion: 1,
      project: { name: 'proof', packageManager: 'npm' },
      capabilities: {},
    }),
    [],
  );
  for (const database of ['postgres', 'mongodb'] as const) {
    await releaseFixture(database);
    const config = {
      schemaVersion: 1 as const,
      project: { name: 'proof', packageManager: 'npm' as const },
      capabilities: {
        foundation: { recipe: 'foundation.nest', options: {} },
        database: { recipe: 'database.' + database, options: {} },
        auth: { recipe: 'auth.local', options: {} },
        mail: { recipe: 'mail.capture', options: { reliableActions: true } },
        storage: { recipe: 'storage.local', options: {} },
        media: { recipe: 'media.owned', options: {} },
        realtime: { recipe: 'realtime.native-ws', options: {} },
        'push-fcm': { recipe: 'push.fcm', options: {} },
        'push-apns': { recipe: 'push.apns', options: {} },
      },
    };
    const files = schema.schemaFiles(config),
      again = schema.schemaFiles(config);
    assert.deepEqual(files, again);
    const selected = files.find((file) =>
      file.path.endsWith('selected-release.ts'),
    )!.content;
    assert.match(selected, /assertSelectedReleaseReady/);
    assert.match(selected, /"identity","version":4/);
    assert.match(selected, /"realtime.native-ws.single-instance","version":1/);
    assert.match(selected, /"push","version":1/);
    const entry = files.find((file) =>
      file.path.endsWith('initialize-selected-schemas.ts'),
    )!.content;
    assert.match(entry, /initializeRealtime/);
    assert.match(entry, /ReleaseCoordinator/);
    assert.doesNotMatch(entry, /forwardRef|ModuleRef|@Global|import\(/);
    const minimal = schema.schemaFiles({
      ...config,
      capabilities: { database: config.capabilities.database },
    });
    assert.doesNotMatch(
      minimal.map((file) => file.content).join('\n'),
      /modules\/|initializeIdentity|initializeRealtime/,
    );
    const assets = await release.renderReleaseFiles(config);
    assert.ok(assets.some((file) => file.path === 'ops/release/README.md'));
    assert.ok(
      assets.some((file) => file.path === 'src/release/native-backup.ts'),
    );
    await compileReleaseCommands(database, [
      ...files,
      ...assets,
      ...configuration.configuration(config).files,
    ]);
  }
});

test('basic local auth selects only its native v1 account schema', async () => {
  const { schema } = await releaseRenderers();
  for (const database of ['mongodb', 'postgres'] as const) {
    const filesFor = (recipe: string, options: Record<string, string>) =>
      schema.schemaFiles({
        schemaVersion: 1,
        project: { name: 'auth-schema-proof', packageManager: 'npm' },
        capabilities: {
          database: { recipe: 'database.' + database, options: {} },
          auth: { recipe, options },
        },
      });
    const email = filesFor('auth.local', { profile: 'basic' });
    const username = filesFor('auth.local', {
      profile: 'basic',
      identifier: 'username',
    });
    assert.deepEqual(email, username);

    const selected = email.find((file) =>
      file.path.endsWith('selected-release.ts'),
    )!.content;
    const manifest = /builtInRelease:ReleaseManifest=(\{[^\n]+\});/.exec(
      selected,
    );
    assert.ok(manifest);
    const { components } = JSON.parse(manifest[1]!) as ReleaseManifest;
    assert.deepEqual(
      components.map(({ component, version }) => ({ component, version })),
      [{ component: 'identity.basic', version: 1 }],
    );
    assert.match(components[0]!.digest, /^[a-f0-9]{64}$/);
    if (database === 'mongodb')
      assert.equal(
        components[0]!.digest,
        '962c63d512052282a2d0eee8c99a85430e133bb5dd66adb4c2642a1adb7ad9d5',
      );

    const initializer = email.find((file) =>
      file.path.endsWith('initialize-selected-schemas.ts'),
    )!.content;
    assert.match(initializer, /modules\/auth\/initialize-auth\.js/);
    assert.match(
      initializer,
      /component:'identity\.basic',apply:async\(\)=>\{const database=await openDatabase\(config,false\);try\{await initializeAuth\(database\);\}finally\{await database\.close\(\);\}\}/,
    );
    assert.doesNotMatch(initializer, /initializeIdentityDatabase/);

    for (const full of [
      filesFor('auth.local', {}),
      filesFor('auth.local', { profile: 'full' }),
      filesFor('auth.firebase', {}),
    ]) {
      const source = full.map((file) => file.content).join('\n');
      assert.match(source, /"identity","version":4/);
      assert.match(source, /initializeIdentityDatabase/);
      assert.doesNotMatch(
        source,
        /identity\.basic|modules\/auth\/initialize-auth/,
      );
    }
  }
});

test('selected Socket.IO scale changes execute their identified schema owner after a completed single-instance release', async () => {
  const { schema } = await releaseRenderers();
  const load = await releaseFixture('postgres'),
    { ReleaseCoordinator } = await load<Coordinator>('release-coordinator');
  const readManifest = (
    database: 'postgres' | 'mongodb',
    scale: 'single-instance' | 'cluster',
  ): ReleaseManifest => {
    const files = schema.schemaFiles({
      schemaVersion: 1,
      project: { name: 'cluster-proof', packageManager: 'npm' },
      capabilities: {
        database: { recipe: 'database.' + database, options: {} },
        realtime: { recipe: 'realtime.socket-io', options: { scale } },
      },
    });
    const source = files.find((file) =>
      file.path.endsWith('selected-release.ts'),
    )!.content;
    const match = /builtInRelease:ReleaseManifest=(\{[^\n]+\});/.exec(source);
    assert.ok(match);
    return JSON.parse(match[1]!) as ReleaseManifest;
  };
  for (const database of ['postgres', 'mongodb'] as const) {
    const single = readManifest(database, 'single-instance'),
      cluster = readManifest(database, 'cluster');
    assert.notEqual(cluster.id, single.id);
    assert.notEqual(
      cluster.components[0]!.digest,
      single.components[0]!.digest,
    );
    assert.equal(
      cluster.components[0]!.component,
      'realtime.socket-io.cluster',
    );
    const store = new ControlledReleaseStore(),
      coordinator = new ReleaseCoordinator(store);
    let calls = 0;
    await coordinator.apply(single, [
      {
        component: single.components[0]!.component,
        apply: async () => {
          calls++;
        },
      },
    ]);
    await coordinator.apply(cluster, [
      {
        component: cluster.components[0]!.component,
        apply: async () => {
          calls++;
        },
      },
    ]);
    await coordinator.apply(cluster, [
      {
        component: cluster.components[0]!.component,
        apply: async () => {
          calls++;
        },
      },
    ]);
    assert.equal(calls, 2);
  }
});

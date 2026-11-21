import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import type { PushStateStore } from '../templates/runtime/common/src/modules/push/push-state-store.js';
import type { PushDestination } from '../templates/runtime/common/src/modules/push/push.entity.js';
import { pushFixture } from './push-lifecycle-fixture.ts';

/** Coordinator-only execution against an already initialized isolated native DB.
 * Does not create/migrate/provision anything. Authority here is synthetic; root's
 * generated identity+push HTTP/rebind gate is separate evidence.
 */
for (const database of ['mongodb', 'postgres'] as const) {
  const url =
    process.env[`VCLI_PUSH_${database.toUpperCase()}_TEST_URL`] ??
    (process.env.VCLI_PUSH_TEST_DATABASE === database
      ? process.env.TEST_DATABASE_URL
      : undefined);
  test(
    `native ${database}: prepared push owner constraints, persistence and exact-generation races`,
    { skip: !url },
    async () => {
      const load = await pushFixture(database);
      const name =
        database === 'mongodb'
          ? 'MongoPushStateStore'
          : 'PostgresPushStateStore';
      const module = await load<
        Record<
          string,
          { connect(url: string, initialize: boolean): Promise<PushStateStore> }
        >
      >(
        `modules/push/${database === 'mongodb' ? 'mongo' : 'postgres'}-push-state-store`,
      );
      const store = await module[name]!.connect(url!, false);
      const peer = await module[name]!.connect(url!, false);
      const { PushRepository } = await load<{
        PushRepository: new (store: PushStateStore) => {
          register(destination: PushDestination): Promise<PushDestination>;
          current(destination: PushDestination): Promise<boolean>;
          removeExact(destination: PushDestination): Promise<boolean>;
        };
      }>('modules/push/push.repository');
      const repository = new PushRepository(store),
        concurrent = new PushRepository(peer);
      const marker = randomUUID();
      const token = `native-controlled-${marker}`;
      const entry: PushDestination = {
        id: randomUUID(),
        accountId: marker,
        sessionId: randomUUID(),
        installationId: randomUUID(),
        installationGeneration: 1,
        generation: randomUUID(),
        scope: `test-${marker}`,
        environment: 'sandbox',
        provider: 'fcm',
        purpose: 'ordinary',
        platform: 'android',
        token,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        updatedAt: Date.now(),
      };
      try {
        // Independent connections contend on the native atomic owner aggregate.
        const foreign = {
          ...entry,
          id: randomUUID(),
          accountId: randomUUID(),
          installationId: randomUUID(),
          generation: randomUUID(),
        };
        const registrations = await Promise.allSettled([
          repository.register(entry),
          concurrent.register(foreign),
        ]);
        assert.equal(
          registrations.filter((r) => r.status === 'fulfilled').length,
          1,
        );
        assert.equal(
          registrations.filter(
            (r) =>
              r.status === 'rejected' &&
              /PUSH_TOKEN_ALREADY_BOUND/.test(String(r.reason)),
          ).length,
          1,
        );
        const winner =
          registrations[0]!.status === 'fulfilled' ? entry : foreign;
        const rotated = await repository.register({
          ...winner,
          id: randomUUID(),
          generation: randomUUID(),
          token: `rotated-${marker}`,
          tokenHash: createHash('sha256')
            .update(`rotated-${marker}`)
            .digest('hex'),
        });
        assert.equal(rotated.id, winner.id);
        assert.equal(await concurrent.removeExact(winner), false);
        assert.equal(await concurrent.current(rotated), true);
        const rebound = await concurrent.register({
          ...rotated,
          id: randomUUID(),
          accountId: randomUUID(),
          sessionId: randomUUID(),
          installationGeneration: 2,
          generation: randomUUID(),
        });
        await assert.rejects(
          repository.register({ ...winner, generation: randomUUID() }),
          /PUSH_BINDING_STALE/,
        );
        assert.equal(await repository.removeExact(rotated), false);
        assert.equal(await repository.current(rebound), true);
        const reopened = await module[name]!.connect(url!, false);
        try {
          assert.equal(
            await new PushRepository(reopened).current(rebound),
            true,
          );
        } finally {
          await reopened.close();
        }
      } finally {
        // Only this test's randomized scope; preserves every other owner row.
        await store.change((state) => ({
          ...state,
          revision: state.revision + 1,
          destinations: state.destinations.filter(
            (d) => d.scope !== entry.scope,
          ),
        }));
        await Promise.all([store.close(), peer.close()]);
      }
    },
  );
}

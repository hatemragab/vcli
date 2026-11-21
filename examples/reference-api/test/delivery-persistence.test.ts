import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { MongoPushStateStore } from '../dist/modules/push/mongo-push-state-store.js';
import { PushRepository } from '../dist/modules/push/push.repository.js';
import type { PushStateStore } from '../dist/modules/push/push-state-store.js';
import type { PushDestination } from '../dist/modules/push/push.entity.js';
for (const driver of ['mongodb'] as const) {
  const url = process.env.TEST_DATABASE_URL;
  test(
    `real ${driver}: push rotation, deduplication, binding and stale cleanup survive restart`,
    {
      skip:
        !url && 'TEST_DATABASE_URL required: prepared local Mongo replica set',
    },
    async () => {
      const connect = (): Promise<PushStateStore> =>
        MongoPushStateStore.connect(url!, true);
      let store = await connect();
      const accountId = `push-test-${randomUUID()}`;
      const installationId = randomUUID();
      const scope = `scope-${randomUUID()}`;
      const token = randomUUID();
      const original: PushDestination = {
        id: randomUUID(),
        generation: randomUUID(),
        accountId,
        installationId,
        sessionId: randomUUID(),
        provider: 'fcm',
        purpose: 'ordinary',
        platform: 'android',
        scope,
        token,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        updatedAt: 1000,
      };
      try {
        let destinations = new PushRepository(store);
        await destinations.register(original);
        await assert.rejects(
          destinations.register({
            ...original,
            id: randomUUID(),
            installationId: randomUUID(),
            accountId: 'another-owner',
          }),
          { code: 'PUSH_TOKEN_ALREADY_BOUND' },
        );
        const rotatedToken = randomUUID();
        const rotated = {
          ...original,
          id: randomUUID(),
          generation: randomUUID(),
          token: rotatedToken,
          tokenHash: createHash('sha256').update(rotatedToken).digest('hex'),
          updatedAt: 2000,
        };
        await destinations.register(rotated);
        assert.equal(
          await destinations.remove(
            accountId,
            installationId,
            original.id,
            original.generation,
          ),
          false,
        );
        await store.close();
        store = await connect();
        destinations = new PushRepository(store);
        assert.equal(
          (await destinations.list(accountId))[0]?.generation,
          rotated.generation,
        );
        const nextOwner = {
          ...rotated,
          id: randomUUID(),
          generation: randomUUID(),
          accountId: `replacement-${accountId}`,
          sessionId: randomUUID(),
          updatedAt: 3000,
        };
        await destinations.register(nextOwner);
        assert.deepEqual(await destinations.list(accountId), []);
        assert.equal(await destinations.current(rotated), false);
        assert.equal(
          await destinations.remove(
            accountId,
            installationId,
            rotated.id,
            rotated.generation,
          ),
          false,
        );
        assert.equal(
          await destinations.remove(
            nextOwner.accountId,
            installationId,
            nextOwner.id,
            nextOwner.generation,
          ),
          true,
        );
      } finally {
        const destinations = new PushRepository(store);
        for (const owner of [accountId, `replacement-${accountId}`])
          for (const entry of await destinations.list(owner))
            await destinations.remove(
              owner,
              installationId,
              entry.id,
              entry.generation,
            );
        await store.close();
      }
    },
  );
}

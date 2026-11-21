import {
  databaseTest as test,
  postgresFixture,
} from './helpers/postgres-fixture.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresMediaStateStore } from '../dist/modules/media/postgres-media-state-store.js';
import { MediaRepository } from '../dist/modules/media/media.repository.js';
import type { MediaStateStore } from '../dist/modules/media/media-state-store.js';
import type { MediaRecord } from '../dist/modules/media/media.entity.js';

{
  test(
    `real PostgreSQL: atomic media reservations, ownership, immutable profile and restart persistence`,
    {},
    async (t) => {
      const { url } = await postgresFixture(t);
      const connect = (): Promise<MediaStateStore> =>
        PostgresMediaStateStore.connect(url, true);
      let store = await connect();
      const ownerId = `media-test-${randomUUID()}`;
      const profile = {
        version: 1,
        driver: 'local',
        root: '/test-owned/private-root',
      } as const;
      const draft = (): MediaRecord => ({
        id: randomUUID(),
        ownerId,
        filename: 'test.bin',
        bytes: 1024,
        sha256: 'a'.repeat(64),
        createdAt: 1000,
        expiresAt: 2000,
        state: 'reserved',
        profile,
        stagingRoot: profile.root,
      });
      try {
        let ledger = new MediaRepository(store);
        const reservations = await Promise.allSettled(
          Array.from({ length: 12 }, () => ledger.reserve(draft())),
        );
        assert.equal(
          reservations.filter((entry) => entry.status === 'fulfilled').length,
          4,
        );
        const records = await ledger.list(ownerId);
        assert.equal(records.length, 4);
        await assert.rejects(
          ledger.get(`different-${ownerId}`, records[0]!.id),
          { code: 'MEDIA_NOT_FOUND' },
        );
        await store.close();
        store = await connect();
        ledger = new MediaRepository(store);
        const persisted = await ledger.list(ownerId);
        assert.equal(persisted.length, 4);
        assert.deepEqual(persisted[0]?.profile, profile);
        const id = persisted[0]!.id;
        const transitions = await Promise.allSettled([
          ledger.transition(ownerId, id, ['reserved'], 'receiving', 1500),
          ledger.transition(ownerId, id, ['reserved'], 'receiving', 1500),
        ]);
        assert.equal(
          transitions.filter((entry) => entry.status === 'fulfilled').length,
          1,
        );
        for (const record of await ledger.list(ownerId)) {
          await ledger.transition(
            ownerId,
            record.id,
            [record.state],
            'deleting',
            100000,
          );
          await ledger.forget(ownerId, record.id);
        }
      } finally {
        await store.close();
      }
    },
  );
}

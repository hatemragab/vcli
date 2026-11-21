import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  databaseTest as test,
  postgresFixture,
} from './helpers/postgres-fixture.ts';
import { NotesService } from '../dist/modules/notes/notes.service.js';
import { noteTable, type Note } from '../dist/modules/notes/notes.entity.js';
import { eq } from 'drizzle-orm';
import type { EventPublisher } from '../dist/core/realtime/event-publisher.js';

const publisher: EventPublisher = {
  async publish() {
    return { status: 'audience-ineligible', transport: 'socketio' };
  },
};

{
  test(
    `real PostgreSQL: compact notes service inherits CRUD, preserves owned ordering and repeats schema setup`,
    {},
    async (t) => {
      const { database } = await postgresFixture(t);
      const service = new NotesService(database, publisher);
      await service.initializeSchema();
      const ownerId = randomUUID();
      const note: Note = {
        id: randomUUID(),
        ownerId,
        title: 'Compact note',
        body: '',
        createdAt: 100,
      };
      await service.createOwned(note, randomUUID());
      await service.initializeSchema();
      assert.deepEqual(await service.getOwned(ownerId, note.id), note);
      const later: Note = {
        ...note,
        id: randomUUID(),
        title: 'Later note',
        createdAt: 200,
      };
      await service.createOwned(later, randomUUID());
      assert.deepEqual(await service.listOwned(ownerId, 1), {
        items: [later],
        truncated: true,
      });
      assert.deepEqual(await service.listOwned(randomUUID(), 10), {
        items: [],
        truncated: false,
      });
      await assert.rejects(
        service.getOwned(randomUUID(), note.id),
        /NOTE_NOT_FOUND/,
      );
      const inherited = await service.findWithPagination(
        { limit: 10 },
        eq(noteTable.ownerId, ownerId),
      );
      assert.equal(inherited.totalCount, 2);
      assert.deepEqual(
        inherited.data.map((row) => row.id),
        [note.id, later.id].sort(),
      );
      assert.equal((await service.findByIdAndDelete(note.id))?.id, note.id);
      assert.equal((await service.findByIdAndDelete(later.id))?.id, later.id);
    },
  );
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { loadConfig } from '../dist/core/config/load-config.js';
import { openDatabase } from '../dist/core/database/database.js';
import { NotesService } from '../dist/modules/notes/notes.service.js';
import {
  noteMongoValidator,
  type Note,
} from '../dist/modules/notes/notes.entity.js';
import type { EventPublisher } from '../dist/core/realtime/event-publisher.js';
const publisher: EventPublisher = {
  async publish() {
    return { status: 'audience-ineligible', transport: 'socketio' };
  },
};
for (const driver of ['mongodb'] as const) {
  const url = process.env.TEST_DATABASE_URL;
  test(
    `real ${driver}: compact notes service inherits CRUD, preserves owned ordering and repeats schema setup`,
    {
      skip:
        !url && 'TEST_DATABASE_URL required: prepared local Mongo replica set',
    },
    async (t) => {
      const database = await openDatabase(
        loadConfig({
          NODE_ENV: 'test',
          DATABASE_URL: url,
        }),
      );
      t.after(() => database.close());
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
      {
        const db = database.connection.db!;
        // Reproduce the former schema's string-_id record; the explicit setup must preserve it.
        await db.command({
          collMod: 'reference_notes',
          validator: noteMongoValidator(false),
        });
        const { id, ...fields } = note;
        await db
          .collection<
            Omit<Note, 'id'> & {
              _id: string;
            }
          >('reference_notes')
          .insertOne({ _id: id, ...fields });
        await service.initializeSchema();
      }
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
        { ownerId },
      );
      assert.equal(inherited.totalCount, 2);
      assert.deepEqual(
        inherited.data.map((row) => row.id),
        [note.id, later.id].sort(),
      );
      assert.equal((await service.deleteOne({ id: note.id })).deletedCount, 1);
      assert.equal((await service.deleteOne({ id: later.id })).deletedCount, 1);
    },
  );
}

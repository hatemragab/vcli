import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openTestDatabase } from './helpers/mongo-fixture.ts';
import { NotesService } from '../dist/modules/notes/notes.service.js';
import { BaseRepository } from '../dist/core/database/base-repository.js';
import type { EventPublisher } from '../dist/core/realtime/event-publisher.js';
test(
  'mutating a listed Mongo note cannot change persisted content or ownership',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const database = await openTestDatabase(t);
    const service = new NotesService(database, {
      async publish() {
        return { status: 'audience-ineligible', transport: 'socketio' };
      },
    });
    const note = {
      id: randomUUID(),
      ownerId: randomUUID(),
      title: 'Persisted content',
      body: 'Original body',
      createdAt: 100,
    };
    const otherOwner = randomUUID();
    await service.createOwned(note, randomUUID());
    const listing = await service.listOwned(note.ownerId, 10);
    assert.equal(listing.items.length, 1);
    Object.assign(listing.items[0]!, {
      title: 'Mutated outside persistence',
      body: 'Unvalidated replacement',
      ownerId: otherOwner,
    });
    listing.items.length = 0;
    assert.deepEqual(await service.getOwned(note.ownerId, note.id), note);
    assert.deepEqual((await service.listOwned(note.ownerId, 10)).items, [note]);
    assert.equal((await service.listOwned(otherOwner, 10)).items.length, 0);
    await assert.rejects(
      service.getOwned(otherOwner, note.id),
      /NOTE_NOT_FOUND/,
    );
  },
);
test(
  'note operation writes before advisory publication and isolates owners',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const database = await openTestDatabase(t);
    const owner = randomUUID();
    const noteId = randomUUID();
    const publisher: EventPublisher = {
      async publish(accountId, event) {
        assert.equal(accountId, owner);
        assert.equal(event.type, 'notes.created');
        assert.equal(
          (await service.getOwned(owner, noteId)).title,
          'Reference note',
        );
        return { status: 'audience-ineligible', transport: 'socketio' };
      },
    };
    const service = new NotesService(database, publisher);
    assert.ok(service instanceof BaseRepository);
    const created = await service.createOwned(
      {
        id: noteId,
        ownerId: owner,
        title: 'Reference note',
        body: '',
        createdAt: 100,
      },
      randomUUID(),
    );
    assert.equal(created.notification.status, 'audience-ineligible');
    assert.equal((await service.listOwned(owner, 20)).items.length, 1);
    assert.equal((await service.listOwned(randomUUID(), 20)).items.length, 0);
    await assert.rejects(
      () => service.getOwned(randomUUID(), noteId),
      /NOTE_NOT_FOUND/,
    );
    await assert.rejects(
      () =>
        service.createOwned(
          {
            id: randomUUID(),
            ownerId: owner,
            title: '',
            body: '',
            createdAt: 100,
          },
          randomUUID(),
        ),
      /INVALID_NOTE/,
    );
  },
);

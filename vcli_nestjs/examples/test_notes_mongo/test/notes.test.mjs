import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openDatabase } from '../dist/core/database/database.js';
import { assertNotesInitialized } from '../dist/modules/notes/initialize-notes.js';
import { assertNotesPrincipal } from '../dist/modules/notes/notes-authority.js';
import { createNoteSchema } from '../dist/modules/notes/notes-input.js';
import { NotesService } from '../dist/modules/notes/notes.service.js';

function principal() {
  return {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    installationGeneration: 1,
    expiresAt: Date.now() + 60_000,
  };
}

test('notes reject a client-supplied owner and a mismatched session owner', async () => {
  const owner = principal();
  const authority = { current: async () => owner };
  assert.ok(createNoteSchema.safeParse({ title: 'A note' }).success);
  assert.equal(
    createNoteSchema.safeParse({ title: 'A note', ownerId: owner.accountId })
      .success,
    false,
  );
  await assertNotesPrincipal(authority, owner);
  await assert.rejects(
    assertNotesPrincipal(authority, { ...owner, accountId: randomUUID() }),
    { code: 'UNAUTHENTICATED', status: 401 },
  );
});

const url = process.env.VCLI_NOTES_TEST_DATABASE_URL;
test(
  'native notes reads and lists are scoped to the current account',
  {
    skip: url
      ? false
      : 'Set VCLI_NOTES_TEST_DATABASE_URL to a released test database',
  },
  async () => {
    const owner = principal();
    const other = principal();
    const sessions = new Map([
      [owner.sessionId, owner],
      [other.sessionId, other],
    ]);
    const authority = { current: async (sessionId) => sessions.get(sessionId) };
    const database = await openDatabase({ database: { url } }, false);
    try {
      await assertNotesInitialized(database);
      const notes = new NotesService(database, authority);
      const id = randomUUID();
      try {
        await notes.createOwned(
          owner,
          { id, title: 'Owned note', body: '', createdAt: Date.now() },
          randomUUID(),
        );
        assert.equal(
          (await notes.getOwned(owner, id)).ownerId,
          owner.accountId,
        );
        assert.deepEqual(
          (await notes.listOwned(owner)).items.map((note) => note.id),
          [id],
        );
        assert.deepEqual((await notes.listOwned(other)).items, []);
        await assert.rejects(notes.getOwned(other, id), {
          code: 'NOTE_NOT_FOUND',
          status: 404,
        });
      } finally {
        await notes.findByIdAndDelete(id);
      }
    } finally {
      await database.close();
    }
  },
);

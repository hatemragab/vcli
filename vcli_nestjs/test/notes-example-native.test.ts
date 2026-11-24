import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  notesFixture,
  type EventPublisher,
  type HttpFixture,
  type Note,
  type Principal,
  type PrincipalAuthority,
  type TestAccess,
} from './notes-example-fixture.ts';

/** Root supplies already released app_notes schemas. This suite provisions/migrates nothing. */
for (const database of ['mongodb', 'postgres'] as const) {
  const url =
    process.env[`VCLI_NOTES_${database.toUpperCase()}_TEST_URL`] ??
    (process.env.VCLI_NOTES_TEST_DATABASE === database
      ? process.env.TEST_DATABASE_URL
      : undefined);
  test(
    `native ${database}: prepared schema, durable ownership/order/Unicode and advisory ambiguity (synthetic auth/provider)`,
    {
      skip: !url ? 'root-owned notes TEST_DATABASE_URL not supplied' : false,
      timeout: 120000,
    },
    async () => {
      const { load } = await notesFixture(database);
      const access = await load<TestAccess>('test-access');
      const module = await load<
        Record<
          string,
          {
            connect(
              url: string,
              initialized: boolean,
            ): Promise<{ close(): Promise<void> }>;
          }
        >
      >(
        `core/database/${database === 'mongodb' ? 'mongo' : 'postgres'}-database`,
      );
      const NativeDatabase =
        module[database === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase']!;
      let db = await NativeDatabase.connect(url!, false);
      const actor: Principal = {
        accountId: randomUUID(),
        sessionId: randomUUID(),
        installationId: randomUUID(),
        installationGeneration: 1,
        expiresAt: Date.now() + 110000,
      };
      const foreign: Principal = {
        ...actor,
        accountId: randomUUID(),
        sessionId: randomUUID(),
        installationId: randomUUID(),
      };
      let revoked = false;
      const authority: PrincipalAuthority = {
        current: async (sessionId) => {
          const current = sessionId === foreign.sessionId ? foreign : actor;
          return revoked
            ? {
                ...current,
                installationGeneration: current.installationGeneration + 1,
              }
            : current;
        },
        verify: async () => actor,
      };
      const { assertNotesInitialized } = await load<{
        assertNotesInitialized(database: unknown): Promise<void>;
      }>('modules/notes/initialize-notes');
      const { startHttp } = await load<HttpFixture>('test-http');
      let server: Awaited<ReturnType<HttpFixture['startHttp']>> | undefined;
      const rows: Note[] = [];
      try {
        await assertNotesInitialized(db);
        const service = new access.NotesService(db, authority);
        const createdAt = Date.now();
        for (let index = 0; index < 23; index++) {
          const draft = {
            id: randomUUID(),
            title:
              index === 0
                ? "  العربية 中文 📝 <script> ' ; DROP TABLE app_notes; --  "
                : `Owned ${index}`,
            body: index === 0 ? '💬'.repeat(5000) : '',
            createdAt: createdAt + (index % 3),
          };
          const result = await service.createOwned(actor, draft, randomUUID());
          assert.equal(result.note.title, draft.title.trim());
          assert.deepEqual(result.notification, { status: 'unavailable' });
          rows.push(structuredClone(result.note));
          (result.note as { title: string }).title = 'caller mutation';
          assert.equal(
            (await service.getOwned(actor, draft.id)).title,
            draft.title.trim(),
          );
        }
        const foreignNote = (
          await service.createOwned(
            foreign,
            {
              id: randomUUID(),
              title: 'Foreign only',
              body: '',
              createdAt: createdAt + 100,
            },
            randomUUID(),
          )
        ).note;
        const expected = [...rows].sort(
          (a, b) =>
            b.createdAt - a.createdAt ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        );
        const page = await service.listOwned(actor);
        assert.equal(page.items.length, 20);
        assert.equal(page.truncated, true);
        assert.deepEqual(
          page.items.map((row) => row.id),
          expected.slice(0, 20).map((row) => row.id),
        );
        assert.deepEqual(
          (await service.listOwned(actor, 1)).items.map((row) => row.id),
          [expected[0]!.id],
        );
        const all = await service.listOwned(actor, 100);
        assert.equal(all.truncated, false);
        assert.deepEqual(
          all.items.map((row) => row.id),
          expected.map((row) => row.id),
        );
        (all.items[0] as { title: string }).title = 'another mutation';
        assert.equal(
          (await service.getOwned(actor, expected[0]!.id)).title,
          expected[0]!.title,
        );
        const missing = await service.getOwned(actor, randomUUID()).then(
          () => null,
          (error) => ({ code: error.code, status: error.status }),
        );
        const hidden = await service.getOwned(actor, foreignNote.id).then(
          () => null,
          (error) => ({ code: error.code, status: error.status }),
        );
        assert.deepEqual(missing, { code: 'NOTE_NOT_FOUND', status: 404 });
        assert.deepEqual(hidden, missing);
        for (const limit of [0, 101, 1.5])
          await assert.rejects(service.listOwned(actor, limit));
        for (const title of ['', ' ', 'a'.repeat(121), '📝'.repeat(61)])
          await assert.rejects(
            service.createOwned(
              actor,
              { id: randomUUID(), title, body: '', createdAt },
              randomUUID(),
            ),
          );
        await assert.rejects(
          access.rejectInvalid(db, randomUUID(), actor.accountId),
          'native constraints must reject blank titles',
        );
        let hints = 0;
        const publisher: EventPublisher = {
          publish: async (accountId, event) => {
            hints++;
            assert.equal(accountId, actor.accountId);
            assert.equal(
              (await access.read(db, String(event.payload.noteId)))?.id,
              event.payload.noteId,
            );
            if (hints === 1) throw new Error('ambiguous-provider-result');
            return {
              status: hints === 2 ? 'unavailable' : 'unknown',
              transport: 'ws',
            };
          },
        };
        const notified = new access.NotesService(db, authority, publisher);
        for (const status of ['unknown', 'unavailable', 'unknown']) {
          const id = randomUUID();
          const result = await notified.createOwned(
            actor,
            { id, title: 'Saved before hint', body: '', createdAt },
            randomUUID(),
          );
          assert.equal(result.notification.status, status);
          assert.equal((await access.read(db, id))?.title, 'Saved before hint');
        }
        assert.equal(hints, 3);
        revoked = true;
        await assert.rejects(service.listOwned(actor));
        await assert.rejects(
          service.createOwned(
            actor,
            { id: randomUUID(), title: 'Denied', body: '', createdAt },
            randomUUID(),
          ),
        );
        revoked = false;
        // Actual loopback HTTP with real native owner service; authentication remains synthetic, not provider sign-in.
        const { ApplicationError } = await load<{
          ApplicationError: new (code: string, status: number) => Error;
        }>('core/errors/application-error');
        const httpAuthority: PrincipalAuthority = {
          ...authority,
          verify: async (proof) => {
            if (
              proof.kind !== 'local' ||
              !['owner', 'foreign'].includes(proof.accessToken)
            )
              throw new ApplicationError('UNAUTHENTICATED', 401);
            return proof.accessToken === 'owner' ? actor : foreign;
          },
        };
        server = await startHttp(httpAuthority, notified);
        const post = (body: unknown) =>
          fetch(server!.url + '/api/notes', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer owner',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          });
        assert.equal(
          (await post({ title: 'Forbidden owner', ownerId: foreign.accountId }))
            .status,
          400,
        );
        const response = await post({ title: 'HTTP persisted' });
        assert.equal(response.status, 201);
        const result = (await response.json()) as { note: Note };
        assert.equal(
          (await access.read(db, result.note.id))?.title,
          'HTTP persisted',
        );
        assert.equal(hints, 4);
        await server.close();
        server = undefined;
        await db.close();
        db = await NativeDatabase.connect(url!, false);
        assert.equal(
          (
            await new access.NotesService(db, authority).getOwned(
              actor,
              result.note.id,
            )
          ).title,
          'HTTP persisted',
        );
      } finally {
        if (server) await server.close();
        try {
          await access.cleanup(db, [actor.accountId, foreign.accountId]);
        } finally {
          await db.close();
        }
      }
    },
  );
}

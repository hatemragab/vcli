import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  notesFixture,
  type EventPublisher,
  type HttpFixture,
  type Note,
  type NotesOperations,
  type Principal,
  type PrincipalAuthority,
  type TestAccess,
} from './notes-example-fixture.ts';

const principal = (): Principal => ({
  accountId: randomUUID(),
  sessionId: randomUUID(),
  installationId: randomUUID(),
  installationGeneration: 1,
  expiresAt: Date.now() + 60000,
});
const draft = (title = 'Hello') => ({
  id: randomUUID(),
  title,
  body: '',
  createdAt: Date.now(),
});
const failure = (code: string, status: number) => (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  'code' in error &&
  error.code === code &&
  'status' in error &&
  error.status === status;
for (const database of ['mongodb', 'postgres'] as const) {
  test(`controlled persistence ${database}: commit precedes one hint, all advisory outcomes preserve success`, async () => {
    const { load } = await notesFixture(database);
    const access = await load<TestAccess>('test-access');
    const actor = principal();
    const authority: PrincipalAuthority = {
      current: async () => actor,
      verify: async () => actor,
    };
    const order: string[] = [],
      rows = new Map<string, Note>();
    let calls = 0;
    let outcome: Awaited<ReturnType<EventPublisher['publish']>> = {
      status: 'unknown',
      transport: 'ws',
    };
    const publisher: EventPublisher = {
      publish: async (account, event) => {
        calls++;
        order.push('hint');
        assert.equal(account, actor.accountId);
        assert(rows.has(String(event.payload.noteId)));
        assert.deepEqual(Object.keys(event.payload), ['noteId']);
        assert.equal(event.type, 'notes.created');
        if (outcome.status === 'unavailable')
          throw new Error('private-provider-failure');
        return { ...outcome, privateProviderField: 'never-returned' };
      },
    };
    const service = new access.NotesService(
      access.controlledDatabase(),
      authority,
      publisher,
    );
    service.create = async (note) => {
      order.push('commit');
      rows.set(note.id, structuredClone(note));
      return note;
    };
    for (const status of [
      'attempted',
      'provider-accepted',
      'audience-ineligible',
      'unknown',
      'unavailable',
    ] as const) {
      outcome = { status, transport: 'ws' };
      order.length = 0;
      const input = draft("  العربية 📝 <script> & ' --  ");
      const result = await service.createOwned(actor, input, randomUUID());
      assert.deepEqual(order, ['commit', 'hint']);
      assert.equal(result.note.title, input.title.trim());
      assert.equal(
        result.notification.status,
        status === 'unavailable' ? 'unknown' : status,
      );
      assert(!('privateProviderField' in result.notification));
      assert(!JSON.stringify(result).includes('private-provider-failure'));
      (result.note as { title: string }).title = 'caller mutation';
      assert.equal(rows.get(input.id)!.title, input.title.trim());
    }
    assert.equal(calls, 5);
    assert.equal(rows.size, 5);
    const offline = new access.NotesService(
      access.controlledDatabase(),
      authority,
    );
    offline.create = service.create;
    assert.deepEqual(
      (await offline.createOwned(actor, draft(), randomUUID())).notification,
      { status: 'unavailable' },
    );
    service.create = async () => {
      throw new Error('WRITE_FAILED');
    };
    const before = calls;
    await assert.rejects(
      service.createOwned(actor, draft(), randomUUID()),
      /WRITE_FAILED/,
    );
    assert.equal(calls, before);
    service.create = async () => {
      throw new Error('COMMIT_OUTCOME_UNKNOWN');
    };
    await assert.rejects(
      service.createOwned(actor, draft(), randomUUID()),
      /COMMIT_OUTCOME_UNKNOWN/,
    );
    assert.equal(calls, before);
  });
  test(`controlled persistence ${database}: authority generation/expiry fencing, strict limits and safe mapping`, async () => {
    const { load } = await notesFixture(database);
    const access = await load<TestAccess>('test-access');
    const actor = principal();
    let current = actor;
    const service = new access.NotesService(access.controlledDatabase(), {
      current: async () => current,
      verify: async () => current,
    });
    let reads = 0,
      writes = 0;
    service.create = async (note) => {
      writes++;
      return note;
    };
    service.findOne = async () => {
      reads++;
      return null;
    };
    service.findMany = async () => {
      reads++;
      return [];
    };
    for (const changed of [
      { installationGeneration: 2 },
      { accountId: randomUUID() },
      { installationId: randomUUID() },
      { sessionId: randomUUID() },
      { expiresAt: Date.now() - 1 },
    ]) {
      current = { ...actor, ...changed };
      await assert.rejects(
        service.createOwned(actor, draft(), randomUUID()),
        failure('UNAUTHENTICATED', 401),
      );
      await assert.rejects(
        service.listOwned(actor),
        failure('UNAUTHENTICATED', 401),
      );
      await assert.rejects(
        service.getOwned(actor, randomUUID()),
        failure('UNAUTHENTICATED', 401),
      );
    }
    assert.equal(reads, 0);
    assert.equal(writes, 0);
    current = actor;
    for (const limit of [0, 101, -1, 1.5, NaN, Infinity])
      await assert.rejects(
        service.listOwned(actor, limit),
        failure('INVALID_LIMIT', 400),
      );
    await assert.rejects(
      service.getOwned(actor, randomUUID()),
      failure('NOTE_NOT_FOUND', 404),
    );
    for (const title of ['', ' '.repeat(4), 'a'.repeat(121), '📝'.repeat(61)])
      await assert.rejects(
        service.createOwned(actor, draft(title), randomUUID()),
        failure('INVALID_NOTE', 400),
      );
    await assert.rejects(
      service.createOwned(
        actor,
        { ...draft(), body: 'a'.repeat(10001) },
        randomUUID(),
      ),
      failure('INVALID_NOTE', 400),
    );
    await assert.rejects(
      service.createOwned(actor, { ...draft(), createdAt: 1.5 }, randomUUID()),
      failure('INVALID_NOTE', 400),
    );
    await assert.rejects(
      service.createOwned(actor, draft(), 'caller-event'),
      failure('INVALID_NOTE', 400),
    );
    await service.createOwned(actor, draft('📝'.repeat(60)), randomUUID());
    const row = {
      ...draft(),
      ownerId: actor.accountId,
      _id: 'native-secret',
      privateField: 'hidden',
    };
    service.findOne = async () => row;
    assert.deepEqual(
      Object.keys(await service.getOwned(actor, row.id)).sort(),
      ['body', 'createdAt', 'id', 'ownerId', 'title'],
    );
  });
}

test('loopback Nest HTTP with synthetic authority and controlled persistence: strict owned routes, correlation and no implicit retry', async () => {
  const { load } = await notesFixture('postgres');
  const { startHttp } = await load<HttpFixture>('test-http');
  const actor = principal(),
    other = principal();
  let creations = 0;
  const rows = new Map<string, Note>();
  const service: NotesOperations = {
    async createOwned(principal, draft, eventId) {
      creations++;
      assert.match(eventId, /^[0-9a-f-]{36}$/);
      const note = { ...draft, ownerId: principal.accountId };
      rows.set(note.id, structuredClone(note));
      return { note, notification: { status: 'unknown' } };
    },
    async listOwned(principal, limit = 20) {
      const items = [...rows.values()].filter(
        (row) => row.ownerId === principal.accountId,
      );
      return { items: items.slice(0, limit), truncated: items.length > limit };
    },
    async getOwned(principal, id) {
      const note = rows.get(id);
      if (!note || note.ownerId !== principal.accountId) {
        const { ApplicationError } = await load<{
          ApplicationError: new (code: string, status: number) => Error;
        }>('core/errors/application-error');
        throw new ApplicationError('NOTE_NOT_FOUND', 404);
      }
      return note;
    },
    async editOwned(principal, id, patch) {
      const note = { ...(await this.getOwned(principal, id)), ...patch };
      rows.set(id, note);
      return note;
    },
    async removeOwned(principal, id) {
      await this.getOwned(principal, id);
      rows.delete(id);
    },
  };
  const { ApplicationError } = await load<{
    ApplicationError: new (code: string, status: number) => Error;
  }>('core/errors/application-error');
  const authority: PrincipalAuthority = {
    current: async () => actor,
    verify: async (proof) => {
      if (
        proof.kind !== 'local' ||
        !['owner', 'other'].includes(proof.accessToken)
      )
        throw new ApplicationError('UNAUTHENTICATED', 401);
      return proof.accessToken === 'owner' ? actor : other;
    },
  };
  const server = await startHttp(authority, service);
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    token = 'owner',
  ) =>
    fetch(server.url + '/api/notes' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        'X-Operation-Id': 'client-controlled',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal(
      (await request('', 'POST', { title: 'x' }, 'invalid')).status,
      401,
    );
    for (const input of [
      { title: 'x', ownerId: other.accountId },
      { title: 'x', id: randomUUID() },
      { title: 'x', createdAt: 1 },
      { title: 'x', filter: { $ne: null } },
      { title: { $gt: '' } },
      { title: ' ' },
      { title: 'a'.repeat(121) },
      { title: 'x', body: 'a'.repeat(10001) },
      { title: 'x', imageId: randomUUID() },
    ])
      assert.equal((await request('', 'POST', input)).status, 400);
    const response = await request('', 'POST', {
      title: "  中文 📝 <script> ' --  ",
    });
    assert.equal(response.status, 201);
    const operationId = response.headers.get('x-operation-id');
    assert.match(operationId!, /^[0-9a-f-]{36}$/);
    assert.notEqual(operationId, 'client-controlled');
    const result = (await response.json()) as {
      note: Note;
      notification: { status: string };
    };
    assert.equal(result.note.title, "中文 📝 <script> ' --");
    assert.equal(result.note.ownerId, actor.accountId);
    assert.equal(result.notification.status, 'unknown');
    assert.equal(creations, 1);
    assert.match(result.note.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    assert.equal(typeof result.note.createdAt, 'number');
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?limit=1.5',
      '?limit=1e1',
      '?limit=1&limit=2',
      '?ownerId=' + other.accountId,
      '?filter[$ne]=null',
    ])
      assert.equal((await request(query)).status, 400, query);
    for (const query of ['', '?limit=1', '?limit=20', '?limit=100'])
      assert.equal((await request(query)).status, 200);
    assert.equal((await request('/' + result.note.id)).status, 200);
    const missing = await request('/' + randomUUID()),
      foreign = await request('/' + result.note.id, 'GET', undefined, 'other');
    assert.equal(missing.status, 404);
    assert.equal(foreign.status, 404);
    assert.deepEqual(await foreign.json(), await missing.json());
    const notePath = '/' + result.note.id;
    for (const patch of [{}, { ownerId: other.accountId }, { imageId: null }])
      assert.equal((await request(notePath, 'PATCH', patch)).status, 400);
    assert.equal(
      (await request(notePath, 'PATCH', { body: 'owned' }, 'other')).status,
      404,
    );
    assert.equal(
      (await request(notePath, 'DELETE', undefined, 'other')).status,
      404,
    );
    const edited = await request(notePath, 'PATCH', { body: 'updated' });
    assert.equal(edited.status, 200);
    assert.deepEqual(await edited.json(), { ...result.note, body: 'updated' });
    const { createNotesClient } = (await import(
      new URL(
        '../templates/runtime/common/clients/notes-client.mjs',
        import.meta.url,
      ).href
    )) as {
      createNotesClient(input: {
        baseUrl: string;
        accessToken: () => Promise<string>;
      }): {
        create(input: unknown): Promise<unknown>;
        edit(id: string, patch: unknown): Promise<Note>;
        remove(id: string): Promise<void>;
        list(limit?: number): Promise<unknown>;
      };
    };
    const client = createNotesClient({
      baseUrl: server.url,
      accessToken: async () => 'owner',
    });
    await client.create({ title: 'Single request' });
    assert.equal(creations, 2);
    await client.list();
    assert.equal(creations, 2);
    assert.equal(
      (await client.edit(result.note.id, { title: 'New title' })).body,
      'updated',
    );
    assert.equal(await client.remove(result.note.id), undefined);
    assert.equal((await request(notePath)).status, 404);
    assert.equal((await request(notePath, 'DELETE')).status, 404);
  } finally {
    await server.close();
  }
});

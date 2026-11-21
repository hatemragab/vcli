import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { z } from 'zod';
import { createReferenceApp } from '../../dist/create-reference-app.js';
import { loadConfig } from '../../dist/core/config/load-config.js';
import { createTestMailCapture } from '../../dist/modules/mail/mail.module.js';
import { onceSocket } from '../helpers/once-socket.ts';
const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  sessionId: z.uuid(),
  installationId: z.uuid(),
});
const frameSchema = z.object({
  type: z.string(),
  event: z.object({ type: z.string() }).optional(),
});
const frame = (input: unknown) => frameSchema.parse(JSON.parse(String(input)));
async function fixture(
  t: TestContext,
  realtime: 'socketio' | 'ws' = 'socketio',
) {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-reference-e2e-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    REALTIME_DRIVER: realtime,
    LOCAL_STORAGE_ROOT: join(directory, 'storage'),
    EVIDENCE_DIRECTORY: join(directory, 'evidence'),
  });
  const capture = createTestMailCapture();
  const runtime = await createReferenceApp(config, { mail: capture.sender });
  t.after(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  await runtime.app.listen(0, '127.0.0.1');
  const base = await runtime.app.getUrl();
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    token?: string,
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value: unknown = await response.json();
    return { status: response.status, body: value, headers: response.headers };
  };
  const user = async () => {
    const email = `${randomUUID()}@example.invalid`;
    const password = 'Disposable integration password 🔐';
    assert.equal(
      (
        await request('/api/identity/local/register', 'POST', {
          email,
          password,
        })
      ).status,
      202,
    );
    const action = capture
      .inspect()
      .find(
        (item) =>
          item.message.to === email && item.message.purpose === 'verification',
      );
    const token = action?.message.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, 'private verification capture must exist');
    assert.equal(
      (
        await request('/api/identity/local/login', 'POST', {
          email,
          password,
          platform: 'web',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/identity/local/verification/confirm', 'POST', {
          token,
          password,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request('/api/identity/local/verification/confirm', 'POST', {
          token,
          password,
        })
      ).status,
      400,
    );
    const login = await request('/api/identity/local/login', 'POST', {
      email,
      password,
      platform: 'web',
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('cache-control'), 'no-store');
    return credentialsSchema.parse(login.body);
  };
  return { runtime, config, base, capture, request, user };
}
test(
  'assembled HTTP app enforces verification, ownership, bounded input, media finalization and revocation',
  {
    timeout: 20000,
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t);
    assert.equal((await f.request('/health/live')).status, 200);
    assert.equal((await f.request('/health/ready')).status, 200);
    assert.equal((await f.request('/reference/config')).status, 200);
    assert.equal((await fetch(f.base + '/docs')).status, 200);
    const openapi: unknown = await (await fetch(f.base + '/docs-json')).json();
    const document = z
      .object({
        paths: z.record(z.string(), z.record(z.string(), z.unknown())),
      })
      .parse(openapi);
    const registration = z
      .object({
        requestBody: z.object({
          content: z.object({
            'application/json': z.object({
              schema: z.object({ required: z.array(z.string()) }),
            }),
          }),
        }),
      })
      .parse(document.paths['/api/identity/local/register']?.post);
    assert.ok(
      registration.requestBody.content[
        'application/json'
      ].schema.required.includes('email'),
    );
    const secured = z
      .object({ security: z.array(z.record(z.string(), z.array(z.string()))) })
      .parse(document.paths['/api/accounts/me']?.get);
    assert.deepEqual(secured.security, [{ bearer: [] }]);
    assert.equal((await f.request('/api/accounts/me')).status, 401);
    const alice = await f.user();
    const bob = await f.user();
    assert.equal(
      (await f.request('/api/accounts/me', 'GET', undefined, alice.accessToken))
        .status,
      200,
    );
    assert.equal(
      (
        await f.request(
          '/api/notes',
          'POST',
          { title: 'Unsafe ownership', ownerId: randomUUID() },
          alice.accessToken,
        )
      ).status,
      400,
    );
    const created = await f.request(
      '/api/notes',
      'POST',
      { title: 'A real owned note', body: 'Reference behavior' },
      alice.accessToken,
    );
    assert.equal(created.status, 201);
    const note = z
      .object({
        note: z.object({ id: z.uuid() }),
        notification: z.object({ status: z.string() }),
      })
      .parse(created.body);
    assert.equal(
      (
        await f.request(
          `/api/notes/${note.note.id}`,
          'GET',
          undefined,
          bob.accessToken,
        )
      ).status,
      404,
    );
    const listing = await f.request(
      '/api/notes',
      'GET',
      undefined,
      alice.accessToken,
    );
    assert.equal(
      z.object({ items: z.array(z.unknown()) }).parse(listing.body).items
        .length,
      1,
    );
    const bytes = Buffer.from('Private streamed reference content.');
    const upload = await f.request(
      '/api/media/uploads',
      'POST',
      {
        filename: 'reference.txt',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      alice.accessToken,
    );
    assert.equal(upload.status, 201);
    const draft = z
      .object({ id: z.uuid(), transfer: z.object({ path: z.string() }) })
      .parse(upload.body);
    const transfer = await fetch(f.base + draft.transfer.path, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${alice.accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    assert.equal(transfer.status, 200);
    assert.equal(
      (
        await f.request(
          `/api/media/uploads/${draft.id}/finalize`,
          'POST',
          {},
          alice.accessToken,
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await f.request(
          `/api/media/uploads/${draft.id}/finalize`,
          'POST',
          {},
          alice.accessToken,
        )
      ).status,
      201,
    );
    const download = await fetch(`${f.base}/api/media/${draft.id}/content`, {
      headers: { Authorization: `Bearer ${alice.accessToken}` },
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(
      (
        await fetch(`${f.base}/api/media/${draft.id}/content`, {
          headers: { Authorization: `Bearer ${bob.accessToken}` },
        })
      ).status,
      404,
    );
    const replay = await fetch(f.base + draft.transfer.path, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${alice.accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    });
    assert.equal(replay.status, 409);
    assert.equal(
      (
        await f.request(
          `/api/media/${draft.id}`,
          'DELETE',
          undefined,
          alice.accessToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          '/api/push/destinations',
          'GET',
          undefined,
          alice.accessToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(
          '/api/sessions/revoke',
          'POST',
          { scope: 'current' },
          alice.accessToken,
        )
      ).status,
      200,
    );
    assert.equal(
      (await f.request('/api/notes', 'GET', undefined, alice.accessToken))
        .status,
      401,
    );
    assert.equal(
      (await f.request('/api/notes', 'GET', undefined, bob.accessToken)).status,
      200,
    );
  },
);
test(
  'Socket.IO uses real local credentials for private note delivery and closes revoked sessions',
  {
    timeout: 15000,
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t);
    const user = await f.user();
    const socket = io(f.base, {
      path: f.config.realtime.path,
      transports: ['websocket'],
      auth: { kind: 'local', accessToken: user.accessToken },
      extraHeaders: { Origin: f.config.publicOrigin },
      autoConnect: false,
      reconnection: false,
    });
    t.after(() => socket.disconnect());
    const admitted = onceSocket(socket, 'admitted');
    socket.connect();
    await admitted;
    const notification = onceSocket(socket, 'notification');
    const created = await f.request(
      '/api/notes',
      'POST',
      { title: 'Socket event', body: '' },
      user.accessToken,
    );
    assert.equal(created.status, 201);
    const [event] = await notification;
    assert.equal(
      z.object({ type: z.string() }).parse(event).type,
      'notes.created',
    );
    assert.equal(
      z
        .object({ notification: z.object({ status: z.string() }) })
        .parse(created.body).notification.status,
      'attempted',
    );
    const disconnected = onceSocket(socket, 'disconnect');
    assert.equal(
      (
        await f.request(
          '/api/sessions/revoke',
          'POST',
          { scope: 'current' },
          user.accessToken,
        )
      ).status,
      200,
    );
    await disconnected;
    assert.equal(socket.connected, false);
  },
);
test(
  'native WebSocket ticket admission, notification, replay denial and revocation work through HTTP authority',
  {
    timeout: 15000,
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t, 'ws');
    const user = await f.user();
    const grant = await f.request(
      '/api/realtime/tickets',
      'POST',
      {},
      user.accessToken,
    );
    assert.equal(grant.status, 201);
    const { ticket } = z.object({ ticket: z.string() }).parse(grant.body);
    const url = f.base.replace('http:', 'ws:') + f.config.realtime.path;
    const socket = new WebSocket(url, { origin: f.config.publicOrigin });
    t.after(() => socket.terminate());
    await once(socket, 'open', { signal: AbortSignal.timeout(5000) });
    const admitted = once(socket, 'message', {
      signal: AbortSignal.timeout(5000),
    });
    socket.send(JSON.stringify({ version: 1, type: 'authenticate', ticket }));
    assert.equal(frame((await admitted)[0]).type, 'admitted');
    const event = once(socket, 'message', {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(
      (
        await f.request(
          '/api/notes',
          'POST',
          { title: 'Native event' },
          user.accessToken,
        )
      ).status,
      201,
    );
    assert.equal(frame((await event)[0]).event?.type, 'notes.created');
    const replay = new WebSocket(url, { origin: f.config.publicOrigin });
    t.after(() => replay.terminate());
    await once(replay, 'open', { signal: AbortSignal.timeout(5000) });
    const denied = once(replay, 'close', { signal: AbortSignal.timeout(5000) });
    replay.send(JSON.stringify({ version: 1, type: 'authenticate', ticket }));
    assert.equal((await denied)[0], 1008);
    const revoked = once(socket, 'close', {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(
      (
        await f.request(
          '/api/sessions/revoke',
          'POST',
          { scope: 'current' },
          user.accessToken,
        )
      ).status,
      200,
    );
    await revoked;
  },
);

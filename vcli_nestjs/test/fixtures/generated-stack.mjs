import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { loadConfig } from '../dist/core/config/load-config.js';
import { createApp } from '../dist/create-app.js';
import { ApplicationError } from '../dist/core/errors/application-error.js';

// This file is copied into an isolated generated app's ignored var directory by the gate.
// Only this test passes programmatic synthetic provider/capture dependencies.
const local = process.env.FIXTURE_AUTH === 'local';
const fetch = globalThis.fetch;
const config = loadConfig();
const capability = () => randomBytes(32).toString('base64url');
const facts = {
  checks: [],
  provider: local ? 'native-jose-argon' : 'synthetic-firebase',
  healthLatencyMs: [],
};
let runtime, origin, capture, fake;
let providerClosed = 0;
const subject = 'fixture-' + randomUUID();
const authenticatedAt = Math.floor(Date.now() / 1000) * 1000;
const fakeProvider = () => ({
  async verify(token) {
    if (
      token !== 'synthetic-id-token' &&
      token !== 'synthetic-refreshed-id-token'
    )
      throw new ApplicationError('UNAUTHENTICATED', 401);
    return {
      projectId: config.auth.firebaseProjectId,
      uid: subject,
      method: 'phone',
      authenticatedAt,
      expiresAt: Date.now() + 600000,
      email: null,
      emailVerified: false,
      linkedMethods: ['phone'],
    };
  },
  async assertCurrent() {},
  async cleanup() {
    return 'completed';
  },
  async close() {
    providerClosed++;
  },
});
async function start() {
  if (local) {
    const module = await import('../dist/modules/mail/mail.module.js');
    capture = module.createTestMailCapture(100);
    runtime = await createApp(config, { mailSender: capture.sender });
  } else {
    fake = fakeProvider();
    runtime = await createApp(config, { identity: { firebase: fake } });
  }
  await runtime.app.listen(0, '127.0.0.1');
  origin = 'http://127.0.0.1:' + runtime.app.getHttpServer().address().port;
}
async function request(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const response = await globalThis.fetch(origin + path, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : raw ? { body: raw } : {}),
    signal: globalThis.AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
}
function check(name) {
  facts.checks.push(name);
}
function authorization(session, token = 'synthetic-id-token') {
  return local
    ? { Authorization: 'Bearer ' + session.accessToken }
    : {
        Authorization: 'Bearer ' + token,
        'X-Session-Token': session.capability,
      };
}
async function current(session, expected = 200) {
  const response = await request('/api/accounts/me', {
    headers: authorization(session),
  });
  assert.equal(response.status, expected, 'CURRENT_STATUS');
  return response.body;
}
try {
  await start();
  assert.equal((await request('/health/ready')).status, 200);
  assert.equal((await request('/api/accounts/me')).status, 401);
  const schema = await request('/docs-json');
  assert.equal(schema.status, 200);
  assert.ok(schema.body.paths['/api/identity/installations/rotate']);
  assert.ok(schema.body.paths['/api/accounts/me/disable']);
  const bootstrapPath = local
    ? '/api/identity/local/login'
    : '/api/identity/firebase/bootstrap';
  assert.deepEqual(schema.body.paths[bootstrapPath].post.security, []);
  assert.deepEqual(
    schema.body.paths['/api/accounts/me'].get.security,
    local ? [{ bearer: [] }] : [{ bearer: [], appSession: [] }],
  );
  check('health-openapi-and-protected-route');
  let first, second;
  if (local) {
    const email = 'fixture-' + randomUUID() + '@example.invalid';
    const passwordA = 'Attacker fixture password A!';
    const passwordB = 'Owner fixture password B!';
    const device = capability();
    for (const password of [passwordA, passwordB])
      assert.equal(
        (
          await request('/api/identity/local/register', {
            method: 'POST',
            body: { email, password },
          })
        ).status,
        202,
      );
    const { MailIntentService } =
      await import('../dist/modules/mail/mail-intent.service.js');
    const intents = runtime.app.get(MailIntentService);
    assert.equal(capture.inspect().length, 0);
    await intents.drain(10);
    const messages = capture.inspect();
    assert.equal(messages.length, 2);
    const proof = messages
      .at(-1)
      .message.text.match(/#token=([A-Za-z0-9_-]{43})/)[1];
    assert.equal(
      (
        await request('/api/identity/local/verification/confirm', {
          method: 'POST',
          body: { token: proof, password: passwordB },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request('/api/identity/local/verification/confirm', {
          method: 'POST',
          body: { token: proof, password: passwordB },
        })
      ).status,
      400,
    );
    const login = async (password, installationCapability = device) =>
      request('/api/identity/local/login', {
        method: 'POST',
        body: { email, password, installationCapability, platform: 'web' },
      });
    assert.equal((await login(passwordA)).status, 401);
    const loggedIn = await login(passwordB);
    assert.equal(loggedIn.status, 200, 'LOGIN_STATUS');
    first = loggedIn.body;
    second = (await login(passwordB, capability())).body;
    const account = await current(first);
    assert.ok(account.id);
    check('atomic-private-mail-proof-and-pre-hijack-denial');
    const badUnicode = await login('bad-\ud800-password-not-well-formed');
    assert.equal(badUnicode.status, 400);
    assert.equal((await login('😀'.repeat(70))).status, 400);
    check('unicode-and-byte-input-bounds');

    const raced = await Promise.all(
      [0, 1].map(() =>
        request('/api/identity/local/refresh', {
          method: 'POST',
          body: { refreshToken: first.refreshToken },
        }),
      ),
    );
    assert.equal(raced.filter((result) => result.status === 200).length, 1);
    assert.equal(raced.filter((result) => result.status === 401).length, 1);
    await current(second); // Replay cannot kill a separately created family.
    check('native-refresh-race-and-family-isolation');
    const rotated = (await login(passwordB)).body;
    assert.ok(rotated.accessToken, 'FRESH_LOGIN_AFTER_PRESSURE');
    const nextDevice = capability();
    const rotation = await request('/api/identity/installations/rotate', {
      method: 'POST',
      headers: authorization(rotated),
      body: {
        confirm: 'rotate-installation',
        password: passwordB,
        installationCapability: device,
        newInstallationCapability: nextDevice,
      },
    });
    assert.equal(rotation.status, 200);
    await current(rotated, 401);
    await current(second);
    const rebound = await login(passwordB, nextDevice);
    assert.equal(rebound.status, 200);
    assert.ok(
      rebound.body.installationGeneration > rotated.installationGeneration,
    );
    first = rebound.body;
    check('proved-installation-rotation-and-generation-fence');
    const loads = Array.from({ length: 8 }, (_, index) =>
      index < 2
        ? login('Wrong fixture password!')
        : request('/api/identity/local/login', {
            method: 'POST',
            body: {
              email: 'unknown-' + randomUUID() + '@example.invalid',
              password: 'Wrong fixture password!',
              installationCapability: capability(),
            },
          }),
    );
    const health = Array.from({ length: 8 }, async () => {
      const before = performance.now();
      const response = await request('/health/live');
      assert.equal(response.status, 200);
      facts.healthLatencyMs.push(Math.round(performance.now() - before));
    });
    const results = await Promise.all(loads);
    await Promise.all(health);
    assert.ok(
      results.every((result) => [401, 429, 503].includes(result.status)),
      'BOUNDED_PRESSURE_OUTCOMES',
    );
    assert.ok(
      Math.max(...facts.healthLatencyMs) < 2000,
      'HEALTH_LATENCY_UNDER_BOUNDED_PRESSURE',
    );
    check('real-hashing-under-bounded-health-pressure');
    await runtime.close();
    await start();
    await current(first);
    await current(second);
    check('generated-runtime-restart-preserves-native-authority');
    const denied = await request('/api/sessions/revoke', {
      method: 'POST',
      headers: authorization(first),
      body: { scope: 'selected', sessionId: randomUUID() },
    });
    assert.equal(denied.status, 404);
    await current(second);
    const revoke = await request('/api/sessions/revoke', {
      method: 'POST',
      headers: authorization(first),
      body: { scope: 'current' },
    });
    assert.equal(revoke.status, 200);
    await current(first, 401);
    await current(second);
    check('owned-revoke-scope-and-surviving-sibling');
  } else {
    const enrollment = capability(),
      device = capability();
    const bootstrap = (
      sessionCapability = enrollment,
      idToken = 'synthetic-id-token',
      installationCapability = device,
    ) =>
      request('/api/identity/firebase/bootstrap', {
        method: 'POST',
        body: {
          idToken,
          sessionCapability,
          installationCapability,
          platform: 'web',
        },
      });
    const raced = await Promise.all(
      Array.from({ length: 4 }, () => bootstrap()),
    );
    assert.ok(
      raced.every((result) => result.status === 200),
      'BOOTSTRAP_RACE_STATUS',
    );
    assert.equal(new Set(raced.map((result) => result.body.sessionId)).size, 1);
    assert.ok(
      raced.every(
        (result) =>
          !('sessionToken' in result.body) && !('accessToken' in result.body),
      ),
    );
    first = { ...raced[0].body, capability: enrollment };
    const refreshed = await bootstrap(
      enrollment,
      'synthetic-refreshed-id-token',
    );
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.sessionId, first.sessionId);
    await current(first);
    check('real-db-synthetic-firebase-retry-stable-bootstrap');
    const siblingCap = capability();
    const sibling = await bootstrap(
      siblingCap,
      'synthetic-id-token',
      capability(),
    );
    assert.equal(sibling.status, 200);
    second = { ...sibling.body, capability: siblingCap };
    const listed = await request('/api/sessions', {
      headers: authorization(first),
    });
    assert.equal(listed.status, 200);
    const serialized = JSON.stringify(listed.body);
    assert.equal(serialized.includes(enrollment), false);
    assert.equal(serialized.includes(siblingCap), false);
    await runtime.close();
    await start();
    const repeated = await bootstrap();
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.sessionId, first.sessionId);
    await current(first);
    await current(second);
    check('private-safe-lists-and-native-restart');
    assert.equal(
      (
        await request('/api/sessions/revoke', {
          method: 'POST',
          headers: authorization(first),
          body: { scope: 'current' },
        })
      ).status,
      200,
    );
    await current(first, 401);
    await current(second);
    assert.equal((await bootstrap()).status, 401);
    check('revoked-capability-does-not-reactivate-or-kill-sibling');
    const rotate = await request('/api/identity/installations/rotate', {
      method: 'POST',
      headers: authorization(second),
      body: {
        confirm: 'rotate-installation',
        idToken: 'synthetic-id-token',
        installationCapability: sibling.body.installationId,
        newInstallationCapability: capability(),
      },
    });
    assert.ok([400, 401].includes(rotate.status));
    await current(second);
    check('installation-id-alone-is-not-possession');
  }
  const selectedRelease = await import('../dist/generated/selected-release.js');
  const ready = await request('/health/ready');
  assert.equal(
    ready.body.schemaReleaseId,
    selectedRelease.selectedReleaseManifest.id,
  );
  assert.equal(ready.body.buildId, '1'.repeat(40));
  facts.buildIdentity =
    'controlled explicit immutable build metadata; no deployed-image proof';
  check('readiness-exact-schema-and-immutable-build-facts');
  const headers = authorization(second);
  assert.equal((await request('/api/notes')).status, 401);
  const notesSchema = await request('/docs-json');
  assert.ok(notesSchema.body.paths['/api/notes']);
  assert.deepEqual(
    notesSchema.body.paths['/api/notes'].post.security,
    local ? [{ bearer: [] }] : [{ bearer: [], appSession: [] }],
  );
  const { createNotesClient } = await import('../clients/notes-client.mjs');
  let notes = createNotesClient({
    baseUrl: origin,
    accessToken: async () =>
      local ? second.accessToken : 'synthetic-id-token',
    ...(local ? {} : { sessionSecret: async () => second.capability }),
  });
  let admitted;
  const admission = new Promise((resolve) => {
    admitted = resolve;
  });
  let received;
  const hint = new Promise((resolve) => {
    received = resolve;
  });
  const { connectSocketIo } = await import('../clients/socket-io.mjs');
  const client = connectSocketIo({
    apiOrigin: origin,
    path: config.realtime.path,
    origin: config.allowedOrigins[0],
    getProof: async () =>
      local
        ? { kind: 'local', accessToken: second.accessToken }
        : {
            kind: 'firebase',
            idToken: 'synthetic-id-token',
            sessionSecret: second.capability,
          },
    recover: async () => {
      await notes.list();
      admitted();
    },
    onHint: (event) => received(event),
    onDenied: () => {},
  });
  const deadline = async (promise) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('REAL_SOCKET_DEADLINE')),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let saved;
  try {
    await deadline(admission);
    const title = 'Private Unicode 😀 <script>literal</script>';
    saved = await notes.create({
      title,
      body: 'SQL-looking text: DROP TABLE notes; stays data',
    });
    assert.equal(saved.note.title, title);
    assert.equal(
      saved.note.body,
      'SQL-looking text: DROP TABLE notes; stays data',
    );
    const event = await deadline(hint);
    assert.equal(event.type, 'notes.created');
    assert.deepEqual(event.payload, { noteId: saved.note.id });
    assert.deepEqual(await notes.get(saved.note.id), saved.note);
    assert.ok(
      (await notes.list()).items.some((item) => item.id === saved.note.id),
    );
    check('real-auth-native-note-and-socketio-advisory-client');
  } finally {
    client.close();
  }
  assert.equal(
    (
      await request('/api/notes', {
        method: 'POST',
        headers,
        body: { title: 'Injected', ownerId: randomUUID() },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/notes?limit=101', { headers })).status,
    400,
  );
  const bytes = randomBytes(8097),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  const begun = await request('/api/media/uploads', {
    method: 'POST',
    headers,
    body: { filename: 'private.bin', bytes: bytes.length, sha256 },
  });
  assert.equal(begun.status, 201);
  const mediaId = begun.body.id;
  assert.equal(
    (
      await request('/api/media/uploads/' + mediaId + '/content', {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        raw: bytes,
      })
    ).status,
    200,
  );
  const finalized = await request(
    '/api/media/uploads/' + mediaId + '/finalize',
    { method: 'POST', headers, body: {} },
  );
  assert.equal(finalized.status, 201);
  assert.equal(finalized.body.state, 'ready');
  const downloaded = await fetch(
    origin + '/api/media/' + mediaId + '/content',
    { headers },
  );
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
  assert.ok(Buffer.from(await downloaded.arrayBuffer()).equals(bytes));
  assert.equal(
    (await fetch(origin + '/api/media/' + mediaId + '/content')).status,
    401,
  );
  check('real-private-local-media-upload-hash-download-boundary');
  await runtime.close();
  await start();
  notes = createNotesClient({
    baseUrl: origin,
    accessToken: async () =>
      local ? second.accessToken : 'synthetic-id-token',
    ...(local ? {} : { sessionSecret: async () => second.capability }),
  });
  assert.deepEqual(await notes.get(saved.note.id), saved.note);
  const reopened = await fetch(origin + '/api/media/' + mediaId + '/content', {
    headers,
  });
  assert.equal(reopened.status, 200);
  assert.ok(Buffer.from(await reopened.arrayBuffer()).equals(bytes));
  assert.equal(
    (
      await request('/api/sessions/revoke', {
        method: 'POST',
        headers,
        body: { scope: 'current' },
      })
    ).status,
    200,
  );
  assert.equal(
    (await request('/api/notes/' + saved.note.id, { headers })).status,
    401,
  );
  assert.equal(
    (await fetch(origin + '/api/media/' + mediaId + '/content', { headers }))
      .status,
    401,
  );
  check('functional-owner-state-restart-and-generation-revocation');
  assert.ok(facts.checks.length >= 9);
  console.log('VCLI_ACCEPTANCE ' + JSON.stringify(facts));
} finally {
  await runtime?.close();
  if (!local) assert.equal(providerClosed, 3);
}

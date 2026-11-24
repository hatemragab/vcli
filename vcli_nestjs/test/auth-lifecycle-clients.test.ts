import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

function mutex() {
  let tail = Promise.resolve();
  return {
    async request<T>(_name: string, work: () => Promise<T>): Promise<T> {
      const previous = tail;
      let unlock = () => {};
      tail = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      try {
        return await work();
      } finally {
        unlock();
      }
    },
  };
}
function sessionStore<T>(initial: T | null = null) {
  let value = initial;
  return {
    async read() {
      return structuredClone(value);
    },
    async write(next: T | null) {
      value = structuredClone(next);
    },
  };
}
async function client(name: 'local' | 'firebase') {
  return import(
    pathToFileURL(resolve(`templates/runtime/common/clients/auth-${name}.mjs`))
      .href
  );
}

test('local client coordinates one refresh across instances/tabs through shared mutex and private store', async () => {
  const { LocalAuthClient } = await client('local');
  const initial = {
      accessToken: 'private-initial-access',
      refreshToken: 'private-initial-refresh',
      expiresAt: 1,
    },
    store = sessionStore(initial),
    locks = mutex();
  let calls = 0;
  const request = async (_url: string, init: RequestInit) => {
    calls++;
    assert.equal(
      JSON.parse(String(init.body)).refreshToken,
      initial.refreshToken,
    );
    return Response.json({
      accessToken: 'private-next-access',
      refreshToken: 'private-next-refresh',
      expiresAt: Date.now() + 60000,
    });
  };
  const options = {
    origin: 'https://app.example.invalid',
    store,
    locks,
    fetch: request,
  };
  const a = new LocalAuthClient(options),
    b = new LocalAuthClient(options);
  await Promise.all([a.refresh(), a.refresh(), b.refresh(), b.refresh()]);
  assert.equal(calls, 1);
  assert.equal((await store.read())?.refreshToken, 'private-next-refresh');
  assert.deepEqual(await a.headers(), {
    Authorization: 'Bearer private-next-access',
  });
});

test('local client lost refresh response clears the family and requires reauthentication without replay', async () => {
  const { LocalAuthClient } = await client('local');
  const store = sessionStore({
    accessToken: 'private-access',
    refreshToken: 'private-refresh',
    expiresAt: 1,
  });
  let calls = 0;
  const auth = new LocalAuthClient({
    origin: 'https://app.example.invalid',
    store,
    locks: mutex(),
    fetch: async () => {
      calls++;
      throw new Error('CONTROLLED_LOST_RESPONSE');
    },
  });
  await assert.rejects(auth.refresh(), /REAUTHENTICATION_REQUIRED/u);
  await assert.rejects(auth.refresh(), /REAUTHENTICATION_REQUIRED/u);
  assert.equal(calls, 1);
  assert.equal(await store.read(), null);
});

test('Firebase client persists/reuses intended capability after a lost response and refreshes only ID token', async () => {
  const { FirebaseAuthClient, createPrivateCapability } =
    await client('firebase');
  const store = sessionStore<Record<string, unknown>>(),
    device = createPrivateCapability(),
    bodies: Record<string, unknown>[] = [];
  let attempt = 0,
    tokenVersion = 1;
  const sdk = {
    async getIdToken() {
      return 'controlled-id-token-' + tokenVersion;
    },
  };
  const auth = new FirebaseAuthClient({
    origin: 'https://app.example.invalid',
    sdk,
    auth: { currentUser: { uid: 'controlled-uid' } },
    store,
    fetch: async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (++attempt === 1)
        throw new Error('CONTROLLED_LOST_BOOTSTRAP_RESPONSE');
      return Response.json({
        sessionId: 'safe-session',
        installationId: 'safe-installation',
        installationGeneration: 1,
        expiresAt: Date.now() + 60000,
      });
    },
  });
  await assert.rejects(
    auth.bootstrap(device),
    /CONTROLLED_LOST_BOOTSTRAP_RESPONSE/u,
  );
  const first = await store.read();
  assert.ok(first?.sessionCapability);
  const results = await Promise.all([
    auth.bootstrap(device),
    auth.bootstrap(device),
  ]);
  assert.equal(attempt, 2);
  assert.equal(bodies[0]?.sessionCapability, bodies[1]?.sessionCapability);
  assert.equal(bodies[1]?.installationCapability, device);
  assert.equal('sessionCapability' in results[0], false);
  tokenVersion++;
  const headers = await auth.headers();
  assert.equal(headers.Authorization, 'Bearer controlled-id-token-2');
  assert.equal(headers['X-Session-Token'], first?.sessionCapability);
});

test('Firebase client exposes all four real SDK methods and app actions never call local credentials', async () => {
  const { FirebaseAuthClient, createPrivateCapability } =
    await client('firebase');
  const calls: string[] = [];
  const provider = (id: string) => ({ providerId: id });
  const sdk = {
    GoogleAuthProvider: function () {
      return provider('google.com');
    },
    OAuthProvider: function (id: string) {
      return provider(id);
    },
    async signInWithEmailAndPassword() {
      calls.push('password');
    },
    async signInWithPhoneNumber() {
      calls.push('phone');
      return {
        async confirm() {
          calls.push('confirm-phone');
        },
      };
    },
    async signInWithPopup(_auth: unknown, value: { providerId: string }) {
      calls.push(value.providerId);
    },
    async getIdToken() {
      return 'controlled-id-token';
    },
  };
  const store = sessionStore<Record<string, unknown>>({
    uid: 'controlled-user',
    sessionCapability: createPrivateCapability(),
    installationCapability: createPrivateCapability(),
  });
  const authClient = new FirebaseAuthClient({
    origin: 'https://app.example.invalid',
    sdk,
    auth: { currentUser: { uid: 'controlled-user' } },
    store,
    fetch: async (url: string) => {
      assert.equal(url.includes('/identity/local/'), false);
      calls.push(new URL(url).pathname);
      return Response.json({ accepted: true });
    },
  });
  await authClient.emailPassword('example@example.invalid', 'private-password');
  await (await authClient.phone('+10000000000', {})).confirm('controlled-code');
  await authClient.google();
  await authClient.apple();
  await authClient.requestApplicationReset('example@example.invalid');
  await authClient.requestApplicationVerification(async () => {});
  assert.deepEqual(calls, [
    'password',
    'phone',
    'confirm-phone',
    'google.com',
    'apple.com',
    '/api/identity/firebase/actions/reset/request',
    '/api/identity/firebase/actions/verification/request',
  ]);
});

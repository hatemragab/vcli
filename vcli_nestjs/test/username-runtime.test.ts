import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { identityFixture } from './auth-lifecycle-fixture.ts';
import { syntheticIdentityPorts } from './auth-lifecycle-ports.ts';

const now = 1800000000000;
const fixtures = new Map<string, ReturnType<typeof identityFixture>>();
function fixture(database: 'mongodb' | 'postgres') {
  let load = fixtures.get(database);
  if (!load) {
    load = identityFixture(database);
    fixtures.set(database, load);
  }
  return load;
}

async function harness(database: 'mongodb' | 'postgres' = 'mongodb') {
  const load = await fixture(database),
    ports = syntheticIdentityPorts();
  const { UsernameCredentials } = await load(
    'modules/identity/username-credentials.service',
  );
  const { SessionIssuer } = await load(
    'modules/sessions/session-issuer.service',
  );
  const { IdentityAuthority } = await load(
    'modules/identity/identity-authority.service',
  );
  const facts = await load('modules/identity/secret-facts');
  let hashes = 0,
    dummies = 0,
    rehash = false;
  const passwords = {
    async hash(password: string) {
      ports.assertOutsideTransaction();
      hashes++;
      return 'controlled:' + password;
    },
    async verify(hash: string, password: string) {
      ports.assertOutsideTransaction();
      return hash === 'controlled:' + password;
    },
    async verifyDummy() {
      ports.assertOutsideTransaction();
      dummies++;
    },
    needsRehash() {
      return rehash;
    },
  };
  const issuer = new SessionIssuer(
    ports.accounts,
    ports.installations,
    ports.sessions,
  );
  const credentials = new UsernameCredentials(
    ports.tx,
    ports.accounts,
    ports.identities,
    passwords,
    issuer,
  );
  const authority = new IdentityAuthority(
    ports.tx,
    ports.accounts,
    ports.installations,
    ports.sessions,
    'local',
    [],
    null,
    null,
    () => now,
  );
  const sessionFacts = () =>
    facts.sessionFacts(now, 3600, 'web', facts.newSecret(), facts.newSecret());
  return {
    load,
    ...ports,
    facts,
    passwords,
    issuer,
    credentials,
    authority,
    sessionFacts,
    counts: () => ({ hashes, dummies }),
    rehash: () => {
      rehash = true;
    },
  };
}

for (const database of ['mongodb', 'postgres'] as const) {
  test(`controlled ${database}: username registration/login establishes no email claim or action`, async () => {
    const h = await harness(database);
    await h.credentials.register(
      'notes_user',
      'original-password-123',
      'a',
      now,
    );
    const account = h.state().accounts.get('a');
    assert.equal(account?.email, null);
    assert.equal(account?.emailVerified, false);
    assert.equal(
      h.state().identities.get('username:notes_user')?.accountId,
      'a',
    );
    const session = await h.credentials.login(
      'notes_user',
      'original-password-123',
      h.sessionFacts(),
    );
    assert.equal(session.identityKey, 'username:notes_user');
    assert.equal(session.kind, 'local');
    assert.equal((await h.authority.current(session.id)).accountId, 'a');
    assert.equal(h.state().actions.size, 0);
    assert.equal(h.state().intents.size, 0);
  });
}

test('controlled raced signup cannot replace the first established username password', async () => {
  const h = await harness();
  await h.credentials.register('notes_user', 'original-password-123', 'a', now);
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      h.credentials.register(
        'notes_user',
        'replacement-password-' + index,
        'other-' + index,
        now + 1,
      ),
    ),
  );
  assert.equal(h.state().accounts.size, 1);
  assert.equal(h.state().identities.size, 1);
  assert.equal(
    h.state().identities.get('username:notes_user')?.passwordHash,
    'controlled:original-password-123',
  );
  await assert.rejects(
    h.credentials.login(
      'notes_user',
      'replacement-password-0',
      h.sessionFacts(),
    ),
    { code: 'INVALID_CREDENTIALS' },
  );
  assert.equal(h.state().sessions.size, 0);
});

test('controlled registration rollback leaves no orphan and retry keeps hashing outside the transaction', async () => {
  const h = await harness();
  h.rollback();
  await assert.rejects(
    h.credentials.register('notes_user', 'original-password-123', 'a', now),
    /CONTROLLED_ROLLBACK/u,
  );
  assert.equal(h.state().accounts.size, 0);
  assert.equal(h.state().identities.size, 0);
  const { UsernameCredentials } = await h.load(
    'modules/identity/username-credentials.service',
  );
  let attempts = 0;
  const retrying = {
    async run<T>(work: (context: object) => Promise<T>) {
      attempts++;
      h.rollback();
      await assert.rejects(h.tx.run(work), /CONTROLLED_ROLLBACK/u);
      attempts++;
      return h.tx.run(work);
    },
  };
  const credentials = new UsernameCredentials(
    retrying,
    h.accounts,
    h.identities,
    h.passwords,
    h.issuer,
  );
  const before = h.counts().hashes;
  await credentials.register('notes_user', 'original-password-123', 'a', now);
  assert.equal(attempts, 2);
  assert.equal(h.counts().hashes, before + 1);
  assert.equal(h.state().accounts.size, 1);
});

test('controlled missing/wrong credentials are uniform and use the bounded dummy path', async () => {
  const h = await harness();
  await assert.rejects(
    h.credentials.login(
      'missing_user',
      'original-password-123',
      h.sessionFacts(),
    ),
    { code: 'INVALID_CREDENTIALS', status: 401 },
  );
  assert.equal(h.counts().dummies, 1);
  await h.credentials.register('notes_user', 'original-password-123', 'a', now);
  await assert.rejects(
    h.credentials.login(
      'notes_user',
      'incorrect-password-123',
      h.sessionFacts(),
    ),
    { code: 'INVALID_CREDENTIALS', status: 401 },
  );
  assert.equal(h.state().sessions.size, 0);
});

test('controlled stale password verification cannot issue a session after credential change', async () => {
  const h = await harness();
  await h.credentials.register('notes_user', 'original-password-123', 'a', now);
  const original = h.passwords.verify;
  h.passwords.verify = async (hash: string, password: string) => {
    const valid = await original(hash, password);
    await h.tx.run((context) =>
      h.identities.replacePassword(
        'username:notes_user',
        1,
        'controlled:new-password-123',
        context,
      ),
    );
    return valid;
  };
  await assert.rejects(
    h.credentials.login(
      'notes_user',
      'original-password-123',
      h.sessionFacts(),
    ),
    { code: 'INVALID_CREDENTIALS' },
  );
  assert.equal(h.state().sessions.size, 0);
});

test('controlled username sessions retain refresh reuse and disabled-account fences', async () => {
  const h = await harness();
  const { RefreshSessions } = await h.load(
    'modules/sessions/refresh-sessions.service',
  );
  await h.credentials.register('notes_user', 'original-password-123', 'a', now);
  const facts = h.sessionFacts();
  const session = await h.credentials.login(
    'notes_user',
    'original-password-123',
    facts,
  );
  const refresh = new RefreshSessions(
    h.tx,
    h.accounts,
    h.installations,
    h.sessions,
  );
  const nextHash = h.facts.capabilityHash(h.facts.newSecret(), 'refresh-token');
  await refresh.rotate(facts.secretHash, nextHash, now + 1);
  await assert.rejects(refresh.rotate(facts.secretHash, nextHash, now + 2), {
    code: 'REFRESH_REUSE',
  });
  await assert.rejects(h.authority.current(session.id), {
    code: 'SESSION_REVOKED',
  });
  const second = await h.credentials.login(
    'notes_user',
    'original-password-123',
    h.sessionFacts(),
  );
  await h.tx.run((context) => h.accounts.disable('a', false, context));
  await assert.rejects(h.authority.current(second.id), {
    code: 'SESSION_REVOKED',
  });
  await assert.rejects(
    h.credentials.login(
      'notes_user',
      'original-password-123',
      h.sessionFacts(),
    ),
    { code: 'INVALID_CREDENTIALS' },
  );
});

test('controlled username password change requires current possession and revokes existing sessions', async () => {
  const h = await harness();
  const { ChangePassword } = await h.load(
    'modules/identity/change-password.service',
  );
  await h.credentials.register('notes_user', 'original-password-123', 'a', now);
  const session = await h.credentials.login(
    'notes_user',
    'original-password-123',
    h.sessionFacts(),
  );
  const actor = await h.authority.current(session.id);
  const change = new ChangePassword(
    h.tx,
    h.accounts,
    h.identities,
    h.installations,
    h.sessions,
    h.passwords,
    60000,
  );
  await assert.rejects(
    change.change(actor, 'incorrect-password-123', 'new-password-123', now),
    {
      code: 'INVALID_CREDENTIALS',
    },
  );
  await change.change(actor, 'original-password-123', 'new-password-123', now);
  await assert.rejects(h.authority.current(session.id), {
    code: 'SESSION_REVOKED',
  });
  await assert.rejects(
    h.credentials.login(
      'notes_user',
      'original-password-123',
      h.sessionFacts(),
    ),
    {
      code: 'INVALID_CREDENTIALS',
    },
  );
  assert.ok(
    await h.credentials.login(
      'notes_user',
      'new-password-123',
      h.sessionFacts(),
    ),
  );
  assert.equal(h.state().accounts.get('a')?.emailVerified, false);
});

test('username schemas canonicalize ASCII names and preserve strict password/capability bounds', async () => {
  const load = await fixture('mongodb');
  const inputs = await load('modules/identity/username-inputs');
  assert.equal(
    inputs.credentials.parse({
      username: ' Notes_User ',
      password: 'original-password-123',
    }).username,
    'notes_user',
  );
  for (const username of [
    'ab',
    'name@example.test',
    'δοκιμή',
    'Kelvin',
    '.leading',
    'a'.repeat(65),
  ])
    assert.equal(inputs.username.safeParse(username).success, false);
  for (const password of ['short', '\ud800'.repeat(12), '😀'.repeat(65)])
    assert.equal(
      inputs.credentials.safeParse({ username: 'notes_user', password })
        .success,
      false,
    );
  assert.equal(
    inputs.credentials.safeParse({
      username: 'notes_user',
      password: 'original-password-123',
      emailVerified: true,
    }).success,
    false,
  );
  assert.equal(
    inputs.loginInput.safeParse({
      username: 'notes_user',
      password: 'original-password-123',
    }).success,
    false,
  );
  const bodies = await load('modules/identity/username-request-bodies');
  assert.deepEqual(Object.keys(bodies.identityRequestBodies).sort(), [
    'login',
    'passwordChange',
    'refresh',
    'register',
  ]);
});

test('username client submits username credentials and exposes no email action operation', async () => {
  const source = await readFile(
    'templates/runtime/common/clients/auth-username.mjs',
    'utf8',
  );
  assert.equal(source.includes('requestAction('), false);
  assert.equal(source.includes('confirmAction('), false);
  const { LocalAuthClient } = await import(
    pathToFileURL(
      process.cwd() + '/templates/runtime/common/clients/auth-username.mjs',
    ).href
  );
  const calls: { path: string; body: unknown }[] = [];
  const client = new LocalAuthClient({
    origin: 'https://example.invalid',
    store: { read: () => null, write: async () => {} },
    locks: {
      request: async (_name: string, work: () => Promise<unknown>) => work(),
    },
    fetch: async (path: string, options: RequestInit) => {
      calls.push({ path, body: JSON.parse(String(options.body)) });
      return Response.json({ status: 'accepted' });
    },
  });
  await client.register('notes_user', 'original-password-123');
  assert.deepEqual(calls, [
    {
      path: 'https://example.invalid/api/identity/local/register',
      body: { username: 'notes_user', password: 'original-password-123' },
    },
  ]);
});

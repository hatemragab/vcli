import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { identityFixture } from './auth-lifecycle-fixture.ts';
import { syntheticIdentityPorts } from './auth-lifecycle-ports.ts';

const now = 1800000000000;
const modules = new Map<string, ReturnType<typeof identityFixture>>();
function fixture(database: 'mongodb' | 'postgres') {
  let value = modules.get(database);
  if (!value) {
    value = identityFixture(database);
    modules.set(database, value);
  }
  return value;
}
async function synthetic(database: 'mongodb' | 'postgres' = 'postgres') {
  const load = await fixture(database),
    ports = syntheticIdentityPorts();
  const { SessionIssuer } = await load(
    'modules/sessions/session-issuer.service',
  );
  const { FirebaseEnrollment } = await load(
    'modules/identity/firebase-enrollment.service',
  );
  const { IdentityAuthority } = await load(
    'modules/identity/identity-authority.service',
  );
  const { SessionManagement } = await load(
    'modules/sessions/session-management.service',
  );
  const facts = await load('modules/identity/secret-facts');
  const issuer = new SessionIssuer(
    ports.accounts,
    ports.installations,
    ports.sessions,
  );
  let proof = {
    projectId: 'controlled-project',
    uid: 'controlled-subject',
    method: 'google.com',
    linkedMethods: ['phone', 'google.com'],
    authenticatedAt: now - 1000,
    expiresAt: now + 3600000,
    email: null,
    emailVerified: false,
  };
  const verifier = {
    async verify() {
      ports.assertOutsideTransaction();
      return proof;
    },
    async assertCurrent() {
      ports.assertOutsideTransaction();
    },
  };
  const enrollment = new FirebaseEnrollment(
    ports.tx,
    ports.accounts,
    ports.identities,
    issuer,
    proof.projectId,
    ['password', 'phone', 'google.com', 'apple.com'],
    60000,
  );
  const authority = new IdentityAuthority(
    ports.tx,
    ports.accounts,
    ports.installations,
    ports.sessions,
    'firebase',
    ['password', 'phone', 'google.com', 'apple.com'],
    null,
    verifier,
    () => now,
  );
  const management = new SessionManagement(
    ports.tx,
    ports.accounts,
    ports.identities,
    ports.installations,
    ports.sessions,
    60000,
  );
  const capability = facts.newSecret(),
    device = facts.newSecret();
  const sessionFacts = (
    secret = capability,
    installation = device,
    at = now,
    allow = false,
  ) =>
    facts.sessionFacts(
      at,
      3600,
      'web',
      secret,
      installation,
      'firebase',
      allow,
    );
  const enroll = (
    secret = capability,
    installation = device,
    at = now,
    allow = false,
  ) =>
    enrollment.enroll(
      proof,
      facts.newId(),
      sessionFacts(secret, installation, at, allow),
    );
  return {
    load,
    ...ports,
    facts,
    issuer,
    verifier,
    enrollment,
    authority,
    management,
    capability,
    device,
    sessionFacts,
    enroll,
    getProof: () => proof,
    proof: (patch: Partial<typeof proof>) => {
      proof = { ...proof, ...patch };
    },
  };
}

for (const database of ['mongodb', 'postgres'] as const) {
  test(`synthetic ${database}: raced/lost Firebase bootstrap reuses one subject capability and installation`, async () => {
    const h = await synthetic(database);
    const rows = await Promise.all(Array.from({ length: 8 }, () => h.enroll()));
    assert.equal(new Set(rows.map((row) => row.id)).size, 1);
    assert.equal(h.state().accounts.size, 1);
    assert.equal(h.state().sessions.size, 1);
    assert.equal(h.state().installations.size, 1);
    assert.equal(
      [...h.state().accounts.values()][0]?.email,
      null,
      'phone/no-email mapping never invents an address',
    );
    const recovered = await h.enroll(h.capability, h.device, now + 120000);
    assert.equal(
      recovered.id,
      rows[0].id,
      'authorized capability survives old auth_time and ID-token refresh',
    );
    await assert.rejects(
      h.enroll(h.facts.newSecret(), h.device, now + 120000),
      { code: 'RECENT_AUTH_REQUIRED' },
    );
    await assert.rejects(h.enroll(h.capability, h.facts.newSecret()), {
      code: 'INSTALLATION_PROOF_REQUIRED',
    });
  });
}

test('synthetic cutoff: revoke current preserves siblings, rejects old/new-capability proof and never calls provider cleanup', async () => {
  const h = await synthetic(),
    a = await h.enroll(),
    b = await h.enroll(h.facts.newSecret(), h.facts.newSecret());
  const actor = await h.authority.current(a.id);
  const list = await h.management.list(actor, now);
  assert.equal(list.length, 2);
  assert.equal(JSON.stringify(list).includes('secretHash'), false);
  await assert.rejects(
    h.management.revoke(actor, 'selected', h.facts.newId(), now),
    { code: 'SESSION_NOT_FOUND' },
  );
  await h.management.revoke(actor, 'current', undefined, now);
  await assert.rejects(h.enroll(), { code: 'SESSION_REVOKED' });
  await assert.rejects(h.enroll(h.facts.newSecret(), h.facts.newSecret()), {
    code: 'REAUTHENTICATION_REQUIRED',
  });
  assert.equal((await h.authority.current(b.id)).sessionId, b.id);
  assert.equal(h.state().intents.size, 0);
  h.proof({ authenticatedAt: now + 1 });
  assert.ok(
    (await h.enroll(h.facts.newSecret(), h.facts.newSecret(), now + 1)).id,
  );
});

test('synthetic installation switch: possession plus fresh explicit switch increments binding and fences delayed authority', async () => {
  const h = await synthetic(),
    first = await h.enroll();
  h.proof({ uid: 'other-subject', method: 'phone', linkedMethods: ['phone'] });
  await assert.rejects(h.enroll(h.facts.newSecret()), {
    code: 'INSTALLATION_SWITCH_CONFIRMATION_REQUIRED',
  });
  const switched = await h.enroll(h.facts.newSecret(), h.device, now, true);
  assert.equal(switched.installationId, first.installationId);
  assert.equal(switched.installationGeneration, 2);
  assert.equal(h.state().sessions.get(first.id)?.revokedAt, now);
  await assert.rejects(h.authority.current(first.id), {
    code: 'SESSION_REVOKED',
  });
  assert.equal(
    (await h.authority.current(switched.id)).installationGeneration,
    2,
  );
});

test('synthetic bootstrap rollback and unknown commit preserve correct recovery semantics', async () => {
  const h = await synthetic();
  h.rollback();
  await assert.rejects(h.enroll(), /CONTROLLED_ROLLBACK/u);
  assert.equal(h.state().accounts.size, 0);
  h.unknownCommit();
  await assert.rejects(h.enroll(), { code: 'COMMIT_OUTCOME_UNKNOWN' });
  assert.equal(h.state().sessions.size, 1);
  const recovered = await h.enroll();
  assert.equal(h.state().sessions.size, 1);
  assert.equal(recovered.id, [...h.state().sessions.values()][0]?.id);
});

async function local() {
  const h = await synthetic();
  const { LocalCredentials } = await h.load(
    'modules/identity/local-credentials.service',
  );
  const { RefreshSessions } = await h.load(
    'modules/sessions/refresh-sessions.service',
  );
  let dummy = 0,
    rehash = false;
  const passwords = {
    async hash(password: string) {
      h.assertOutsideTransaction();
      return 'controlled:' + password;
    },
    async verify(hash: string, password: string) {
      h.assertOutsideTransaction();
      return hash === 'controlled:' + password;
    },
    async verifyDummy() {
      h.assertOutsideTransaction();
      dummy++;
    },
    needsRehash() {
      return rehash;
    },
  };
  const credentials = new LocalCredentials(
    h.tx,
    h.accounts,
    h.identities,
    passwords,
    h.issuer,
  );
  const email = 'test@example.invalid',
    password = 'initial-password-123',
    accountId = h.facts.newId();
  await credentials.register(email, password, accountId, now);
  const login = () =>
    credentials.login(
      email,
      password,
      h.facts.sessionFacts(now, 3600, 'web', h.facts.newSecret(), h.device),
    );
  return {
    ...h,
    passwords,
    credentials,
    email,
    password,
    accountId,
    login,
    dummy: () => dummy,
    rehash: () => {
      rehash = true;
    },
    refresh: new RefreshSessions(h.tx, h.accounts, h.installations, h.sessions),
  };
}

test('synthetic local: dummy and changed-policy rehash preserve credential authority', async () => {
  const h = await local();
  await assert.rejects(
    h.credentials.login(
      'unknown@example.invalid',
      h.password,
      h.sessionFacts(),
    ),
    { code: 'INVALID_CREDENTIALS' },
  );
  assert.equal(h.dummy(), 1);
  await assert.rejects(h.login(), { code: 'EMAIL_VERIFICATION_REQUIRED' });
  await h.tx.run((ctx) => h.accounts.verifyEmail(h.accountId, ctx));
  h.rehash();
  const before = h
    .state()
    .identities.get('local:' + h.email)!.credentialVersion;
  await h.login();
  assert.equal(
    h.state().identities.get('local:' + h.email)?.credentialVersion,
    before + 1,
  );
});

test('synthetic refresh: race/reuse revokes its family while independent login survives', async () => {
  const h = await local();
  await h.tx.run((ctx) => h.accounts.verifyEmail(h.accountId, ctx));
  const first = await h.login();
  const initial = [...h.state().refresh.values()][0]!;
  const rotated = await Promise.allSettled([
    h.refresh.rotate(
      initial.hash,
      h.facts.capabilityHash(h.facts.newSecret(), 'refresh-token'),
      now,
    ),
    h.refresh.rotate(
      initial.hash,
      h.facts.capabilityHash(h.facts.newSecret(), 'refresh-token'),
      now,
    ),
  ]);
  assert.equal(rotated.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(h.state().sessions.get(first.id)?.revokedAt, now);
  const independent = await h.login();
  await assert.rejects(
    h.refresh.rotate(
      initial.hash,
      h.facts.capabilityHash(h.facts.newSecret(), 'refresh-token'),
      now,
    ),
    { code: 'REFRESH_REUSE' },
  );
  assert.equal(h.state().sessions.get(independent.id)?.revokedAt, null);
});

test('synthetic action delivery: prepare once outside transaction, stage with action context, preserve pre-hijack proof password and rollback', async () => {
  const h = await local();
  const { ActionTokens } = await h.load(
    'modules/identity/action-tokens.service',
  );
  let sends = 0,
    prepares = 0,
    stages = 0;
  const mail = {
    async submit() {
      sends++;
      return { status: 'accepted' };
    },
  };
  const delivery = {
    prepare(message: object) {
      h.assertOutsideTransaction();
      prepares++;
      return message;
    },
    async stage(_prepared: object, context: object) {
      h.assertContext(context);
      stages++;
    },
  };
  const actions = new ActionTokens(
    h.tx,
    h.accounts,
    h.identities,
    h.sessions,
    h.passwords,
    mail,
    delivery,
  );
  const hash = h.facts.capabilityHash(h.facts.newSecret(), 'action-token');
  await actions.request(h.email, 'verification', hash, now, {
    operationId: h.facts.newId(),
    to: h.email,
    purpose: 'verification',
    subject: 'Verification',
    text: 'private controlled action',
  });
  assert.equal(prepares, 1);
  assert.equal(stages, 1);
  assert.equal(sends, 0);
  const confirmations = await Promise.allSettled([
    actions.confirm(hash, 'verification', now, 'holder-chosen-password-123'),
    actions.confirm(hash, 'verification', now, 'attacker-pending-password-123'),
  ]);
  assert.equal(
    confirmations.filter((row) => row.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    h.state().identities.get('local:' + h.email)?.passwordHash,
    'controlled:holder-chosen-password-123',
  );
  await assert.rejects(h.login(), { code: 'INVALID_CREDENTIALS' });
  const reset = h.facts.capabilityHash(h.facts.newSecret(), 'action-token');
  const broken = new ActionTokens(
    h.tx,
    h.accounts,
    h.identities,
    h.sessions,
    h.passwords,
    mail,
    {
      ...delivery,
      async stage() {
        throw new Error('CONTROLLED_STAGE_FAILURE');
      },
    },
  );
  await assert.rejects(
    broken.request(h.email, 'password-reset', reset, now, {
      operationId: h.facts.newId(),
      to: h.email,
      purpose: 'password-reset',
      subject: 'Reset',
      text: 'private controlled action',
    }),
    /CONTROLLED_STAGE_FAILURE/u,
  );
  assert.equal(h.state().actions.has(reset), false);
});

async function freshServices(h: Awaited<ReturnType<typeof synthetic>>) {
  const { FreshIdentityProof } = await h.load(
    'modules/identity/fresh-identity-proof.service',
  );
  const { AccountLifecycle } = await h.load(
    'modules/identity/account-lifecycle.service',
  );
  const { ProviderCleanupDispatcher } = await h.load(
    'modules/identity/provider-cleanup-dispatcher.service',
  );
  const { ProviderLinks } = await h.load(
    'modules/identity/provider-links.service',
  );
  const fresh = new FreshIdentityProof(
    h.tx,
    h.accounts,
    h.identities,
    h.installations,
    h.sessions,
    null,
    h.verifier,
    ['password', 'phone', 'google.com', 'apple.com'],
    60000,
  );
  return {
    fresh,
    lifecycle: new AccountLifecycle(
      h.tx,
      h.accounts,
      h.identities,
      h.sessions,
      fresh,
      h.cleanup,
    ),
    ProviderCleanupDispatcher,
    links: new ProviderLinks(
      h.tx,
      h.identities,
      h.sessions,
      fresh,
      h.verifier,
      h.cleanup,
      'controlled-project',
      ['password', 'phone', 'google.com', 'apple.com'],
      60000,
    ),
  };
}

test('synthetic provider disable/delete: durable revoke survives failure/restart and never restores account authority', async () => {
  const h = await synthetic(),
    session = await h.enroll(),
    actor = await h.authority.current(session.id);
  const { lifecycle, ProviderCleanupDispatcher } = await freshServices(h);
  const result = await lifecycle.act(
    actor,
    'delete',
    { idToken: 'controlled-token' },
    now,
  );
  assert.equal(result.status, 'deleted-retained');
  assert.equal(result.providerCleanup, 'pending');
  assert.equal(result.applicationCleanup, 'required');
  assert.equal(h.state().accounts.get(actor.accountId)?.enabled, false);
  assert.equal(h.state().accounts.get(actor.accountId)?.email, null);
  await assert.rejects(h.authority.current(session.id), {
    code: 'SESSION_REVOKED',
  });
  let calls = 0,
    clock = now;
  const provider = {
    async cleanup() {
      h.assertOutsideTransaction();
      calls++;
      return calls === 1 ? 'retry' : 'completed';
    },
  };
  const first = new ProviderCleanupDispatcher(
    h.tx,
    h.identities,
    h.cleanup,
    provider,
    () => clock,
  );
  assert.deepEqual(await first.drain(1), { processed: 1, completed: 0 });
  clock += 3000;
  const restarted = new ProviderCleanupDispatcher(
    h.tx,
    h.identities,
    h.cleanup,
    provider,
    () => clock,
  );
  assert.deepEqual(await restarted.drain(1), { processed: 1, completed: 1 });
  assert.equal([...h.state().intents.values()][0]?.status, 'completed');
  await assert.rejects(h.enroll(h.facts.newSecret(), h.facts.newSecret()), {
    code: 'UNAUTHENTICATED',
  });
});

test('synthetic provider unlink: last method denied, owned sibling survives and unknown unlink stays fenced across restart', async () => {
  const h = await synthetic(),
    current = await h.enroll();
  h.proof({ method: 'phone' });
  const sibling = await h.enroll(h.facts.newSecret(), h.facts.newSecret());
  h.proof({ method: 'google.com' });
  const actor = await h.authority.current(current.id),
    { links, ProviderCleanupDispatcher } = await freshServices(h);
  await links.unlink(
    actor,
    { idToken: 'controlled-token' },
    'controlled-target',
    'google.com',
    now,
  );
  await assert.rejects(h.authority.current(current.id), {
    code: 'SESSION_REVOKED',
  });
  assert.equal((await h.authority.current(sibling.id)).sessionId, sibling.id);
  let calls = 0;
  const provider = {
    async cleanup() {
      h.assertOutsideTransaction();
      calls++;
      return 'unknown';
    },
  };
  await new ProviderCleanupDispatcher(
    h.tx,
    h.identities,
    h.cleanup,
    provider,
    () => now,
  ).drain(1);
  await new ProviderCleanupDispatcher(
    h.tx,
    h.identities,
    h.cleanup,
    provider,
    () => now + 60000,
  ).drain(1);
  assert.equal(calls, 1);
  assert.equal([...h.state().identities.values()][0]?.cleanupPending, true);
  const one = await synthetic();
  one.proof({ linkedMethods: ['google.com'] });
  const only = await one.enroll(),
    onlyActor = await one.authority.current(only.id),
    services = await freshServices(one);
  await assert.rejects(
    services.links.unlink(
      onlyActor,
      { idToken: 'controlled' },
      'controlled',
      'google.com',
      now,
    ),
    { code: 'LAST_RECOVERY_METHOD' },
  );
});

test('actual crypto wrappers: strict Unicode/input, changed Argon policy, JWT key/issuer/audience/expiry and safe error mapping', async () => {
  const load = await fixture('postgres');
  const { ArgonPasswords } = await load(
    'modules/identity/argon-passwords.service',
  );
  const { JoseAccessTokens } = await load(
    'modules/identity/jose-access-tokens.service',
  );
  const passwords = await ArgonPasswords.create();
  const unicode = 'pässword🔐e\u0301-12345',
    hash = await passwords.hash(unicode);
  assert.equal(await passwords.verify(hash, unicode), true);
  assert.equal(await passwords.verify(hash, unicode.normalize('NFC')), false);
  for (const value of [
    'short',
    'a'.repeat(129),
    '🔐'.repeat(65),
    '\ud800' + 'a'.repeat(20),
  ])
    await assert.rejects(passwords.hash(value), {
      code: 'PASSWORD_INPUT_INVALID',
    });
  const changed = await ArgonPasswords.create({ timeCost: 3 });
  assert.equal(changed.needsRehash(hash), true);
  await passwords.verifyDummy('unknown-account-password-123');
  const oldKey = randomBytes(32),
    nextKey = randomBytes(32);
  const policy = {
    issuer: 'issuer',
    audience: 'audience',
    activeSigningKeyId: 'old',
    keys: [{ id: 'old', key: oldKey }],
  };
  const tokens = new JoseAccessTokens(policy),
    input = {
      accountId: 'account',
      sessionId: 'session',
      installationId: 'installation',
      now,
      expiresAt: now + 60000,
    },
    token = await tokens.issue(input);
  assert.equal((await tokens.verify(token, now)).sessionId, 'session');
  for (const bad of [
    { ...policy, issuer: 'wrong' },
    { ...policy, audience: 'wrong' },
    { ...policy, keys: [{ id: 'old', key: nextKey }] },
  ])
    await assert.rejects(new JoseAccessTokens(bad).verify(token, now), {
      code: 'INVALID_ACCESS_TOKEN',
    });
  await assert.rejects(tokens.verify(token, now + 60000), {
    code: 'INVALID_ACCESS_TOKEN',
  });
  const overlap = new JoseAccessTokens({
    ...policy,
    activeSigningKeyId: 'next',
    keys: [...policy.keys, { id: 'next', key: nextKey }],
  });
  assert.equal((await overlap.verify(token, now)).sessionId, 'session');
  await assert.rejects(
    new JoseAccessTokens({
      ...policy,
      activeSigningKeyId: 'next',
      keys: [{ id: 'next', key: nextKey }],
    }).verify(token, now),
    { code: 'INVALID_ACCESS_TOKEN' },
  );
});

test('durable limiter wrapper is fail-closed for rate storage failures', async () => {
  const load = await fixture('postgres'),
    { IdentityRateLimits } = await load(
      'modules/identity/identity-rate-limits.service',
    );
  const tx = {
    async run(work: (ctx: object) => Promise<unknown>) {
      return work({});
    },
  };
  const limited = new IdentityRateLimits(tx, {
    async spendRate() {
      return false;
    },
  });
  await assert.rejects(
    limited.spend([{ key: 'private-hash', limit: 3 }], now),
    { status: 429 },
  );
  const unavailable = new IdentityRateLimits(tx, {
    async spendRate() {
      throw new Error('PRIVATE_DATABASE_DETAILS');
    },
  });
  await assert.rejects(
    unavailable.spend([{ key: 'private-hash', limit: 3 }], now),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes('PRIVATE_DATABASE_DETAILS'),
  );
});

test('synthetic local self actions require the current password and atomically disable/delete without claiming business erasure', async () => {
  for (const action of ['disable', 'delete']) {
    const h = await local();
    await h.tx.run((ctx) => h.accounts.verifyEmail(h.accountId, ctx));
    const session = await h.login();
    const { FreshIdentityProof } = await h.load(
      'modules/identity/fresh-identity-proof.service',
    );
    const { AccountLifecycle } = await h.load(
      'modules/identity/account-lifecycle.service',
    );
    const actor = {
      accountId: session.accountId,
      sessionId: session.id,
      installationId: session.installationId,
      installationGeneration: session.installationGeneration,
      expiresAt: session.expiresAt,
    };
    const fresh = new FreshIdentityProof(
      h.tx,
      h.accounts,
      h.identities,
      h.installations,
      h.sessions,
      h.passwords,
      null,
      [],
      60000,
    );
    const lifecycle = new AccountLifecycle(
      h.tx,
      h.accounts,
      h.identities,
      h.sessions,
      fresh,
      null,
    );
    await assert.rejects(
      lifecycle.act(actor, action, { password: 'wrong-current-password' }, now),
      { code: 'INVALID_CREDENTIALS' },
    );
    assert.equal(h.state().accounts.get(h.accountId)?.enabled, true);
    h.rollback();
    await assert.rejects(
      lifecycle.act(actor, action, { password: h.password }, now),
      /CONTROLLED_ROLLBACK/u,
    );
    assert.equal(h.state().accounts.get(h.accountId)?.enabled, true);
    const result = await lifecycle.act(
      actor,
      action,
      { password: h.password },
      now,
    );
    assert.equal(result.applicationCleanup, 'required');
    assert.equal(result.providerCleanup, 'not-required');
    assert.equal(h.state().accounts.get(h.accountId)?.enabled, false);
    assert.equal(h.state().sessions.get(session.id)?.revokedAt, now);
    if (action === 'delete')
      assert.equal(h.state().accounts.get(h.accountId)?.email, null);
    await assert.rejects(h.login(), { code: 'INVALID_CREDENTIALS' });
  }
});

test('synthetic unknown unlink permits explicit account disable while fencing the superseded cleanup generation', async () => {
  const h = await synthetic(),
    first = await h.enroll();
  h.proof({ method: 'phone' });
  const sibling = await h.enroll(h.facts.newSecret(), h.facts.newSecret());
  h.proof({ method: 'google.com' });
  const services = await freshServices(h),
    actor = await h.authority.current(first.id);
  await services.links.unlink(
    actor,
    { idToken: 'controlled-token' },
    'controlled',
    'google.com',
    now,
  );
  await new services.ProviderCleanupDispatcher(
    h.tx,
    h.identities,
    h.cleanup,
    {
      async cleanup() {
        return 'unknown';
      },
    },
    () => now,
  ).drain(1);
  h.proof({ method: 'phone' });
  const siblingActor = await h.authority.current(sibling.id);
  await services.lifecycle.act(
    siblingActor,
    'disable',
    { idToken: 'controlled-token' },
    now,
  );
  assert.equal(h.state().accounts.get(siblingActor.accountId)?.enabled, false);
  let calls = 0;
  await new services.ProviderCleanupDispatcher(
    h.tx,
    h.identities,
    h.cleanup,
    {
      async cleanup(_key: string, action: string) {
        calls++;
        assert.equal(action, 'revoke');
        return 'completed';
      },
    },
    () => now + 60000,
  ).drain(2);
  assert.equal(calls, 1, 'only the new inactive generation may issue revoke');
});

test('synthetic ownership-proven provider link rejects a subject owned by another account', async () => {
  const h = await synthetic(),
    first = await h.enroll(),
    actor = await h.authority.current(first.id),
    current = h.getProof();
  h.proof({ uid: 'foreign-subject' });
  await h.enroll(h.facts.newSecret(), h.facts.newSecret());
  const foreign = h.getProof();
  h.proof(current);
  const { FreshIdentityProof } = await h.load(
    'modules/identity/fresh-identity-proof.service',
  );
  const { ProviderLinks } = await h.load(
    'modules/identity/provider-links.service',
  );
  const verifier = {
    ...h.verifier,
    async verify(token: string) {
      return token === 'foreign-token' ? foreign : current;
    },
  };
  const fresh = new FreshIdentityProof(
    h.tx,
    h.accounts,
    h.identities,
    h.installations,
    h.sessions,
    null,
    verifier,
    ['google.com', 'phone'],
    60000,
  );
  const links = new ProviderLinks(
    h.tx,
    h.identities,
    h.sessions,
    fresh,
    verifier,
    h.cleanup,
    current.projectId,
    ['google.com', 'phone'],
    60000,
  );
  await assert.rejects(
    links.link(actor, { idToken: 'owned-token' }, 'foreign-token', now),
    { code: 'IDENTITY_LINK_CONFLICT' },
  );
  assert.equal(h.state().accounts.size, 2);
});

test('synthetic installation rotation requires old possession and revokes exact generation after fresh proof', async () => {
  const h = await synthetic(),
    current = await h.enroll(),
    actor = await h.authority.current(current.id);
  const { InstallationLifecycle } = await h.load(
      'modules/identity/installation-lifecycle.service',
    ),
    services = await freshServices(h);
  const lifecycle = new InstallationLifecycle(
    h.tx,
    h.installations,
    h.sessions,
    services.fresh,
  );
  await assert.rejects(
    lifecycle.rotate(
      actor,
      { idToken: 'controlled-token' },
      h.facts.newSecret(),
      h.facts.newSecret(),
      now,
    ),
    { code: 'INSTALLATION_PROOF_REQUIRED' },
  );
  assert.equal(h.state().sessions.get(current.id)?.revokedAt, null);
  const result = await lifecycle.rotate(
    actor,
    { idToken: 'controlled-token' },
    h.device,
    h.facts.newSecret(),
    now,
  );
  assert.equal(result.installationGeneration, 2);
  await assert.rejects(h.authority.current(current.id), {
    code: 'SESSION_REVOKED',
  });
});

test('synthetic password reset rejects wrong purpose/expiry, rolls back consumption and keeps unknown commit final', async () => {
  const h = await local();
  await h.tx.run((ctx) => h.accounts.verifyEmail(h.accountId, ctx));
  await h.login();
  const { ActionTokens } = await h.load(
    'modules/identity/action-tokens.service',
  );
  const actions = new ActionTokens(
    h.tx,
    h.accounts,
    h.identities,
    h.sessions,
    h.passwords,
    {
      async submit() {
        return { status: 'captured', captureId: 'controlled' };
      },
    },
  );
  const request = async () => {
    const hash = h.facts.capabilityHash(h.facts.newSecret(), 'action-token');
    await actions.request(h.email, 'password-reset', hash, now, {
      operationId: h.facts.newId(),
      to: h.email,
      purpose: 'password-reset',
      subject: 'Reset',
      text: 'private controlled action',
    });
    return hash;
  };
  const wrong = await request();
  await assert.rejects(
    actions.confirm(wrong, 'verification', now, 'replacement-password-123'),
    { code: 'INVALID_ACTION' },
  );
  assert.equal(h.state().actions.get(wrong)?.consumedAt, null);
  await assert.rejects(
    actions.confirm(
      wrong,
      'password-reset',
      now + 900000,
      'replacement-password-123',
    ),
    { code: 'INVALID_ACTION' },
  );
  const hash = await request();
  h.rollback();
  await assert.rejects(
    actions.confirm(hash, 'password-reset', now, 'replacement-password-123'),
    /CONTROLLED_ROLLBACK/u,
  );
  assert.equal(h.state().actions.get(hash)?.consumedAt, null);
  h.unknownCommit();
  await assert.rejects(
    actions.confirm(hash, 'password-reset', now, 'replacement-password-123'),
    { code: 'COMMIT_OUTCOME_UNKNOWN' },
  );
  assert.equal(h.state().actions.get(hash)?.consumedAt, now);
  const version = h
    .state()
    .identities.get('local:' + h.email)?.credentialVersion;
  await assert.rejects(
    actions.confirm(
      hash,
      'password-reset',
      now,
      'second-replacement-password-123',
    ),
    { code: 'INVALID_ACTION' },
  );
  assert.equal(
    h.state().identities.get('local:' + h.email)?.credentialVersion,
    version,
  );
  assert.equal(
    [...h.state().sessions.values()].every((row) => row.revokedAt !== null),
    true,
  );
});

test('synthetic fresh self proof rechecks the enrollment cutoff in the same durable authority transaction', async () => {
  const h = await synthetic(),
    session = await h.enroll(),
    actor = await h.authority.current(session.id),
    { fresh } = await freshServices(h);
  const proof = await fresh.verify(actor, { idToken: 'controlled-token' }, now);
  await h.management.revoke(actor, 'others', undefined, now);
  assert.equal(h.state().sessions.get(session.id)?.revokedAt, null);
  await assert.rejects(
    h.tx.run((ctx) => fresh.assertCurrent(actor, proof, now, ctx)),
    { code: 'REAUTHENTICATION_REQUIRED' },
  );
});

test('synthetic unlink recovery ignores linked methods excluded by the selected application allowlist', async () => {
  const h = await synthetic(),
    current = await h.enroll(),
    actor = await h.authority.current(current.id),
    { fresh } = await freshServices(h);
  const { ProviderLinks } = await h.load(
    'modules/identity/provider-links.service',
  );
  const links = new ProviderLinks(
    h.tx,
    h.identities,
    h.sessions,
    fresh,
    h.verifier,
    h.cleanup,
    'controlled-project',
    ['google.com'],
    60000,
  );
  await assert.rejects(
    links.unlink(
      actor,
      { idToken: 'controlled' },
      'controlled',
      'google.com',
      now,
    ),
    { code: 'LAST_RECOVERY_METHOD' },
  );
  assert.equal(h.state().sessions.get(current.id)?.revokedAt, null);
});

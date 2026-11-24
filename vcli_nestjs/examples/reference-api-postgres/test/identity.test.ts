import assert from 'node:assert/strict';
import { test as policyTest } from 'node:test';
import {
  databaseTest as test,
  postgresFixture,
} from './helpers/postgres-fixture.ts';
import { SignJWT } from 'jose';
import { ApplicationError } from '../dist/core/errors/application-error.js';
import { AccountService } from '../dist/modules/accounts/account.service.js';
import { IdentityService } from '../dist/modules/identity/identity.service.js';
import { InstallationService } from '../dist/modules/installations/installation.service.js';
import { SessionService } from '../dist/modules/sessions/session.service.js';
import { LocalCredentials } from '../dist/modules/identity/local-credentials.service.js';
import { ActionTokens } from '../dist/modules/identity/action-tokens.service.js';
import { ChangePassword } from '../dist/modules/identity/change-password.service.js';
import { FirebaseEnrollment } from '../dist/modules/identity/firebase-enrollment.service.js';
import { IdentityRateLimits } from '../dist/modules/identity/identity-rate-limits.service.js';
import { SessionIssuer } from '../dist/modules/sessions/session-issuer.service.js';
import { SessionManagement } from '../dist/modules/sessions/session-management.service.js';
import { RefreshSessions } from '../dist/modules/sessions/refresh-sessions.service.js';
import { IdentityAuthority } from '../dist/modules/identity/identity-authority.service.js';
import { JoseAccessTokens } from '../dist/modules/identity/jose-access-tokens.service.js';
import { ArgonPasswords } from '../dist/modules/identity/argon-passwords.service.js';
import {
  secretHash,
  newSecret,
  newId,
  sessionFacts,
} from '../dist/modules/identity/secret-facts.js';
import {
  password,
  credentials,
  verificationInput,
} from '../dist/modules/identity/identity-inputs.js';
import type { MailMessage } from '../dist/core/mail/mail-submitter.js';
import type {
  FirebaseIdentity,
  FirebaseVerifier,
} from '../dist/modules/identity/credential-ports.js';
import type { Session } from '../dist/modules/sessions/session.entity.js';
import type { Action } from '../dist/modules/identity/identity.entity.js';
import type { Transactions } from '../dist/core/database/transaction-context.js';
const now = 1700000000000;
const email = 'test@example.invalid';
const pass = 'a sufficiently long password';
const jwtSecret = 'test-only-signing-key-with-at-least-32-bytes';
const rejectsCode = (code: string) => (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === code;
const actor = (session: Session) => ({
  accountId: session.accountId,
  sessionId: session.id,
  installationId: session.installationId,
  expiresAt: session.expiresAt,
});
function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// Fake password/provider ports are deliberate policy evidence; a separate test exercises real Argon2/jose.
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const { database: db } = await postgresFixture(t);
  const accounts = new AccountService(db),
    identities = new IdentityService(db),
    installations = new InstallationService(db),
    sessions = new SessionService(db);
  const passwords = {
    dummyHash: 'hash:dummy',
    async hash(value: string) {
      return 'hash:' + value;
    },
    async verify(hash: string, value: string) {
      return hash === 'hash:' + value;
    },
    needsRehash() {
      return false;
    },
  };
  const messages: MailMessage[] = [];
  const mail = {
    async submit(message: MailMessage) {
      messages.push(message);
      return { status: 'captured' as const, reference: message.operationId };
    },
  };
  const issuer = new SessionIssuer(accounts, installations, sessions);
  const local = new LocalCredentials(
    db,
    accounts,
    identities,
    passwords,
    issuer,
  );
  const actions = new ActionTokens(
    db,
    accounts,
    identities,
    sessions,
    passwords,
    mail,
  );
  const refresh = new RefreshSessions(db, accounts, installations, sessions);
  const manager = new SessionManagement(
    db,
    accounts,
    identities,
    installations,
    sessions,
    300000,
  );
  const change = new ChangePassword(
    db,
    accounts,
    identities,
    installations,
    sessions,
    passwords,
    300000,
  );
  const tokens = new JoseAccessTokens(jwtSecret, 'test-issuer', 'test-api');
  const uniqueEmail = newId() + '@example.invalid';
  async function registered(verified = true) {
    await local.register(uniqueEmail, pass, newId(), now);
    const identity = await db.run((ctx) =>
      identities.find('local:' + uniqueEmail, ctx),
    );
    assert.ok(identity);
    if (verified)
      await db.run((ctx) => accounts.verifyEmail(identity.accountId, ctx));
    return identity;
  }
  async function emailedAction(purpose: Action['purpose'], at = now) {
    const token = newSecret();
    const outcome = await actions.request(
      uniqueEmail,
      purpose,
      secretHash(token),
      at,
      {
        operationId: newId(),
        to: uniqueEmail,
        subject: 'Private test action',
        text:
          'https://reference.example.invalid/?action=' +
          purpose +
          '#token=' +
          token,
        purpose,
      },
    );
    assert.equal(outcome?.status, 'captured');
    const message = messages.at(-1);
    assert.ok(message);
    // Inspect only the private test mailbox; never put its contents in assertions.
    const capturedToken = new URLSearchParams(
      new URL(message.text).hash.slice(1),
    ).get('token');
    assert.ok(capturedToken);
    return capturedToken;
  }
  const facts = (at = now) => sessionFacts(at, 3600, 'android', newSecret());
  return {
    db,
    accounts,
    identities,
    installations,
    sessions,
    passwords,
    messages,
    issuer,
    local,
    actions,
    refresh,
    manager,
    change,
    tokens,
    uniqueEmail,
    registered,
    emailedAction,
    facts,
  };
}
test('registration races enforce one normalized local identity; unverified and unknown login deny', async (t) => {
  const f = await fixture(t);
  await Promise.all([
    f.local.register(f.uniqueEmail, pass, newId(), now),
    f.local.register(f.uniqueEmail, pass, newId(), now),
  ]);
  assert.ok(
    await f.db.run((ctx) => f.identities.find('local:' + f.uniqueEmail, ctx)),
  );
  await assert.rejects(
    f.local.login(f.uniqueEmail, pass, f.facts()),
    rejectsCode('EMAIL_VERIFICATION_REQUIRED'),
  );
  await assert.rejects(
    f.local.login(newId() + '@example.invalid', pass, f.facts()),
    rejectsCode('INVALID_CREDENTIALS'),
  );
  await assert.rejects(
    f.local.login(f.uniqueEmail, 'wrong password value', f.facts()),
    rejectsCode('INVALID_CREDENTIALS'),
  );
});
test('purpose-bound action verifies once; reset races revoke all sessions and invalidate prior password', async (t) => {
  const f = await fixture(t);
  await f.registered(false);
  const verify = newSecret();
  await f.actions.request(
    f.uniqueEmail,
    'verification',
    secretHash(verify),
    now,
    {
      operationId: newId(),
      to: f.uniqueEmail,
      subject: 'verify',
      text: 'test-only secret ' + verify,
      purpose: 'verification',
    },
  );
  assert.equal(f.messages.length, 1);
  await assert.rejects(
    f.actions.confirm(secretHash(verify), 'password-reset', now, pass),
    rejectsCode('INVALID_ACTION'),
  );
  await f.actions.confirm(secretHash(verify), 'verification', now, pass);
  await assert.rejects(
    f.actions.confirm(secretHash(verify), 'verification', now, pass),
    rejectsCode('INVALID_ACTION'),
  );
  const session = await f.local.login(f.uniqueEmail, pass, f.facts());
  const reset = newSecret();
  await f.actions.request(
    f.uniqueEmail,
    'password-reset',
    secretHash(reset),
    now,
    {
      operationId: newId(),
      to: f.uniqueEmail,
      subject: 'reset',
      text: 'test-only secret ' + reset,
      purpose: 'password-reset',
    },
  );
  const results = await Promise.allSettled([
    f.actions.confirm(
      secretHash(reset),
      'password-reset',
      now + 1,
      'replacement password value',
    ),
    f.actions.confirm(
      secretHash(reset),
      'password-reset',
      now + 1,
      'another replacement password',
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await f.db.run((ctx) => f.sessions.findById(session.id, { context: ctx })))
      ?.revokedAt,
    now + 1,
  );
  await assert.rejects(
    f.local.login(f.uniqueEmail, pass, f.facts(now + 2)),
    rejectsCode('INVALID_CREDENTIALS'),
  );
  const successful =
    results[0]?.status === 'fulfilled'
      ? 'replacement password value'
      : 'another replacement password';
  assert.ok(await f.local.login(f.uniqueEmail, successful, f.facts(now + 2)));
});
test('email proof holder chooses the verified password after a different-password duplicate signup', async (t) => {
  const f = await fixture(t);
  const attackerPassword = 'attacker pending password';
  const ownerPassword = 'owner chosen password';
  await f.local.register(f.uniqueEmail, attackerPassword, newId(), now);
  const olderVerification = await f.emailedAction('verification');
  const olderReset = await f.emailedAction('password-reset');
  await f.local.register(f.uniqueEmail, ownerPassword, newId(), now + 1);
  const ownerProof = await f.emailedAction('verification', now + 1);
  await f.actions.confirm(
    secretHash(ownerProof),
    'verification',
    now + 2,
    ownerPassword,
  );
  await assert.rejects(
    f.local.login(f.uniqueEmail, attackerPassword, f.facts(now + 3)),
    rejectsCode('INVALID_CREDENTIALS'),
  );
  assert.ok(
    await f.local.login(f.uniqueEmail, ownerPassword, f.facts(now + 3)),
  );
  const identity = await f.db.run((ctx) =>
    f.identities.find('local:' + f.uniqueEmail, ctx),
  );
  assert.equal(identity?.credentialVersion, 2);
  assert.equal(identity?.enrollmentCutoff, now + 2);
  for (const [token, purpose] of [
    [ownerProof, 'verification'],
    [olderVerification, 'verification'],
    [olderReset, 'password-reset'],
  ] as const)
    await assert.rejects(
      f.actions.confirm(secretHash(token), purpose, now + 4, attackerPassword),
      rejectsCode('INVALID_ACTION'),
    );
  // A later duplicate signup also cannot replace the established credential.
  await f.local.register(f.uniqueEmail, attackerPassword, newId(), now + 5);
  assert.ok(
    await f.local.login(f.uniqueEmail, ownerPassword, f.facts(now + 6)),
  );
});
test('expired email proof cannot establish a password or verify an account', async (t) => {
  const f = await fixture(t);
  const identity = await f.registered(false);
  const expired = await f.emailedAction('verification', now - 86400000);
  await assert.rejects(
    f.actions.confirm(
      secretHash(expired),
      'verification',
      now,
      'email holder chosen password',
    ),
    rejectsCode('INVALID_ACTION'),
  );
  assert.equal(
    (
      await f.db.run((ctx) =>
        f.accounts.findById(identity.accountId, { context: ctx }),
      )
    )?.emailVerified,
    false,
  );
  assert.equal(
    (await f.db.run((ctx) => f.identities.find(identity.key, ctx)))
      ?.credentialVersion,
    1,
  );
  await assert.rejects(
    f.local.login(f.uniqueEmail, pass, f.facts()),
    rejectsCode('EMAIL_VERIFICATION_REQUIRED'),
  );
  const fresh = await f.emailedAction('verification');
  await f.actions.confirm(
    secretHash(fresh),
    'verification',
    now + 1,
    'email holder chosen password',
  );
  assert.ok(
    await f.local.login(
      f.uniqueEmail,
      'email holder chosen password',
      f.facts(now + 2),
    ),
  );
});
for (const proofCount of [1, 2])
  test(`concurrent confirmation of ${proofCount === 1 ? 'one email proof' : 'two same-version email proofs'} establishes exactly one chosen credential`, async (t) => {
    const f = await fixture(t);
    await f.registered(false);
    const firstProof = await f.emailedAction('verification');
    const secondProof =
      proofCount === 1 ? firstProof : await f.emailedAction('verification');
    const chosen = ['first chosen password', 'second chosen password'] as const;
    const results = await Promise.allSettled([
      f.actions.confirm(
        secretHash(firstProof),
        'verification',
        now + 1,
        chosen[0],
      ),
      f.actions.confirm(
        secretHash(secondProof),
        'verification',
        now + 1,
        chosen[1],
      ),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter(
        (r) =>
          r.status === 'rejected' && rejectsCode('INVALID_ACTION')(r.reason),
      ).length,
      1,
    );
    const winner = results[0]?.status === 'fulfilled' ? chosen[0] : chosen[1];
    const loser = results[0]?.status === 'fulfilled' ? chosen[1] : chosen[0];
    assert.ok(await f.local.login(f.uniqueEmail, winner, f.facts(now + 2)));
    for (const obsolete of [pass, loser])
      await assert.rejects(
        f.local.login(f.uniqueEmail, obsolete, f.facts(now + 2)),
        rejectsCode('INVALID_CREDENTIALS'),
      );
    assert.equal(
      (
        await f.db.run((ctx) =>
          f.identities.find('local:' + f.uniqueEmail, ctx),
        )
      )?.credentialVersion,
      2,
    );
  });
for (const firstPurpose of ['verification', 'password-reset'] as const)
  test(`verification and reset contend on credential version with ${firstPurpose} submitted first`, async (t) => {
    const f = await fixture(t);
    await f.registered(false);
    const verification = await f.emailedAction('verification');
    const reset = await f.emailedAction('password-reset');
    const choices = {
      verification: {
        token: verification,
        password: 'email holder chosen password',
      },
      'password-reset': {
        token: reset,
        password: 'reset holder chosen password',
      },
    };
    const purposes: Action['purpose'][] =
      firstPurpose === 'verification'
        ? ['verification', 'password-reset']
        : ['password-reset', 'verification'];
    const results = await Promise.allSettled(
      purposes.map((purpose) =>
        f.actions.confirm(
          secretHash(choices[purpose].token),
          purpose,
          now + 1,
          choices[purpose].password,
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.filter(
        (r) =>
          r.status === 'rejected' && rejectsCode('INVALID_ACTION')(r.reason),
      ).length,
      1,
    );
    const winner =
      results[0]?.status === 'fulfilled' ? purposes[0] : purposes[1];
    assert.ok(winner);
    const identity = await f.db.run((ctx) =>
      f.identities.find('local:' + f.uniqueEmail, ctx),
    );
    assert.ok(identity);
    assert.equal(identity.credentialVersion, 2);
    const account = await f.db.run((ctx) =>
      f.accounts.findById(identity.accountId, { context: ctx }),
    );
    assert.equal(account?.emailVerified, winner === 'verification');
    await assert.rejects(
      f.local.login(f.uniqueEmail, pass, f.facts(now + 2)),
      rejectsCode('INVALID_CREDENTIALS'),
    );
    for (const purpose of purposes)
      await assert.rejects(
        f.actions.confirm(
          secretHash(choices[purpose].token),
          purpose,
          now + 2,
          pass,
        ),
        rejectsCode('INVALID_ACTION'),
      );
    if (winner === 'verification') {
      assert.ok(
        await f.local.login(
          f.uniqueEmail,
          choices.verification.password,
          f.facts(now + 2),
        ),
      );
    } else {
      await assert.rejects(
        f.local.login(
          f.uniqueEmail,
          choices['password-reset'].password,
          f.facts(now + 2),
        ),
        rejectsCode('EMAIL_VERIFICATION_REQUIRED'),
      );
      const freshProof = await f.emailedAction('verification', now + 3);
      await f.actions.confirm(
        secretHash(freshProof),
        'verification',
        now + 4,
        choices.verification.password,
      );
      await assert.rejects(
        f.local.login(
          f.uniqueEmail,
          choices['password-reset'].password,
          f.facts(now + 5),
        ),
        rejectsCode('INVALID_CREDENTIALS'),
      );
      assert.ok(
        await f.local.login(
          f.uniqueEmail,
          choices.verification.password,
          f.facts(now + 5),
        ),
      );
    }
  });
test('pending-password login cannot finish after email confirmation establishes another credential', async (t) => {
  const f = await fixture(t);
  await f.registered(false);
  const proof = await f.emailedAction('verification');
  const verifying = signal();
  const release = signal();
  const local = new LocalCredentials(
    f.db,
    f.accounts,
    f.identities,
    {
      ...f.passwords,
      async verify(hash, value) {
        verifying.resolve();
        await release.promise;
        return f.passwords.verify(hash, value);
      },
    },
    f.issuer,
  );
  const attemptedLogin = Promise.allSettled([
    local.login(f.uniqueEmail, pass, f.facts(now + 1)),
  ]);
  await verifying.promise;
  const chosenPassword = 'email holder new password';
  try {
    await f.actions.confirm(
      secretHash(proof),
      'verification',
      now + 2,
      chosenPassword,
    );
  } finally {
    release.resolve();
  }
  const [result] = await attemptedLogin;
  assert.ok(
    result?.status === 'rejected' &&
      rejectsCode('INVALID_CREDENTIALS')(result.reason),
  );
  assert.ok(
    await f.local.login(f.uniqueEmail, chosenPassword, f.facts(now + 3)),
  );
});
test('email confirmation rolls back credential, verification and proof consumption on revocation failure', async (t) => {
  const f = await fixture(t);
  const identity = await f.registered(false);
  const refreshSecret = newSecret();
  // Deliberately seed obsolete authority: pending public login cannot issue it.
  const legacySession = await f.db.run(async (ctx) => {
    await f.accounts.lock(identity.accountId, ctx);
    return f.issuer.issue(
      identity.accountId,
      identity.key,
      'local',
      'password',
      now,
      sessionFacts(now, 3600, 'other', refreshSecret),
      ctx,
    );
  });
  const proof = await f.emailedAction('verification');
  const actions = new ActionTokens(
    f.db,
    f.accounts,
    f.identities,
    Object.assign(Object.create(f.sessions) as typeof f.sessions, {
      async revoke() {
        throw new ApplicationError('TEST_REVOCATION_UNAVAILABLE', 503);
      },
    }),
    f.passwords,
    {
      async submit() {
        return { status: 'captured', reference: newId() };
      },
    },
  );
  const chosenPassword = 'email holder chosen password';
  await assert.rejects(
    actions.confirm(secretHash(proof), 'verification', now + 1, chosenPassword),
    rejectsCode('TEST_REVOCATION_UNAVAILABLE'),
  );
  assert.equal(
    (
      await f.db.run((ctx) =>
        f.accounts.findById(identity.accountId, { context: ctx }),
      )
    )?.emailVerified,
    false,
  );
  assert.equal(
    (await f.db.run((ctx) => f.identities.find(identity.key, ctx)))
      ?.credentialVersion,
    1,
  );
  assert.equal(
    (
      await f.db.run((ctx) =>
        f.sessions.findById(legacySession.id, { context: ctx }),
      )
    )?.revokedAt,
    null,
  );
  await assert.rejects(
    f.local.login(f.uniqueEmail, pass, f.facts(now + 2)),
    rejectsCode('EMAIL_VERIFICATION_REQUIRED'),
  );
  await f.actions.confirm(
    secretHash(proof),
    'verification',
    now + 3,
    chosenPassword,
  );
  assert.equal(
    (
      await f.db.run((ctx) =>
        f.sessions.findById(legacySession.id, { context: ctx }),
      )
    )?.revokedAt,
    now + 3,
  );
  await assert.rejects(
    f.refresh.rotate(
      secretHash(refreshSecret),
      secretHash(newSecret()),
      now + 4,
    ),
    rejectsCode('SESSION_REVOKED'),
  );
  assert.ok(
    await f.local.login(f.uniqueEmail, chosenPassword, f.facts(now + 4)),
  );
});
test('confirmation hashes once outside transaction callbacks even when the callback is retried', async (t) => {
  const f = await fixture(t);
  await f.registered(false);
  const proof = await f.emailedAction('verification');
  let active = false;
  let hashCalls = 0;
  let callbacks = 0;
  const abort = new ApplicationError('TEST_RETRY', 503);
  const retrying: Transactions = {
    async run(work) {
      try {
        await f.db.run(async (ctx) => {
          active = true;
          callbacks++;
          try {
            await work(ctx);
            throw abort;
          } finally {
            active = false;
          }
        });
      } catch (error) {
        if (error !== abort) throw error;
      }
      return f.db.run(async (ctx) => {
        active = true;
        callbacks++;
        try {
          return await work(ctx);
        } finally {
          active = false;
        }
      });
    },
  };
  const actions = new ActionTokens(
    retrying,
    f.accounts,
    f.identities,
    f.sessions,
    {
      ...f.passwords,
      async hash(value) {
        assert.equal(active, false);
        hashCalls++;
        return f.passwords.hash(value);
      },
    },
    {
      async submit() {
        return { status: 'captured', reference: newId() };
      },
    },
  );
  const chosenPassword = 'retry holder chosen password';
  await actions.confirm(
    secretHash(proof),
    'verification',
    now + 1,
    chosenPassword,
  );
  assert.equal(callbacks, 2);
  assert.equal(hashCalls, 1);
  assert.equal(
    (await f.db.run((ctx) => f.identities.find('local:' + f.uniqueEmail, ctx)))
      ?.credentialVersion,
    2,
  );
  assert.ok(
    await f.local.login(f.uniqueEmail, chosenPassword, f.facts(now + 2)),
  );
});
test('expired and stale-version action tokens fail; mail unavailability does not roll back accepted action', async (t) => {
  const f = await fixture(t);
  await f.registered();
  const secret = newSecret();
  const actions = new ActionTokens(
    f.db,
    f.accounts,
    f.identities,
    f.sessions,
    f.passwords,
    {
      async submit() {
        return { status: 'unknown', code: 'TIMEOUT' };
      },
    },
  );
  assert.equal(
    (
      await actions.request(
        f.uniqueEmail,
        'password-reset',
        secretHash(secret),
        now,
        {
          operationId: newId(),
          to: f.uniqueEmail,
          subject: 'reset',
          text: 'private',
          purpose: 'password-reset',
        },
      )
    )?.status,
    'unknown',
  );
  await assert.rejects(
    actions.confirm(secretHash(secret), 'password-reset', now + 900001, pass),
    rejectsCode('INVALID_ACTION'),
  );
  const fresh = newSecret();
  await actions.request(
    f.uniqueEmail,
    'password-reset',
    secretHash(fresh),
    now,
    {
      operationId: newId(),
      to: f.uniqueEmail,
      subject: 'reset',
      text: 'private',
      purpose: 'password-reset',
    },
  );
  const session = await f.local.login(f.uniqueEmail, pass, f.facts());
  await f.change.change(
    actor(session),
    pass,
    'updated password value',
    now + 1,
  );
  await assert.rejects(
    actions.confirm(secretHash(fresh), 'password-reset', now + 2, pass),
    rejectsCode('INVALID_ACTION'),
  );
});
test('strict concurrent refresh yields one successor; replay revokes its family and preserves independent login', async (t) => {
  const f = await fixture(t);
  await f.registered();
  const initial = newSecret(),
    facts = sessionFacts(now, 3600, 'ios', initial);
  const first = await f.local.login(f.uniqueEmail, pass, facts);
  const second = await f.local.login(f.uniqueEmail, pass, f.facts());
  const successorA = newSecret(),
    successorB = newSecret();
  const results = await Promise.allSettled([
    f.refresh.rotate(secretHash(initial), secretHash(successorA), now + 1),
    f.refresh.rotate(secretHash(initial), secretHash(successorB), now + 1),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(
    results.some(
      (r) => r.status === 'rejected' && rejectsCode('REFRESH_REUSE')(r.reason),
    ),
  );
  assert.equal(
    (await f.db.run((ctx) => f.sessions.findById(first.id, { context: ctx })))
      ?.revokedAt,
    now + 1,
  );
  assert.equal(
    (await f.db.run((ctx) => f.sessions.findById(second.id, { context: ctx })))
      ?.revokedAt,
    null,
  );
  const successor =
    results[0]?.status === 'fulfilled' ? successorA : successorB;
  await assert.rejects(
    f.refresh.rotate(secretHash(successor), secretHash(newSecret()), now + 2),
    rejectsCode('SESSION_REVOKED'),
  );
});
test('lost refresh response requires reauthentication; unknown credential never creates a session', async (t) => {
  const f = await fixture(t);
  await f.registered();
  const initial = newSecret();
  const session = await f.local.login(
    f.uniqueEmail,
    pass,
    sessionFacts(now, 3600, 'other', initial),
  );
  await f.refresh.rotate(secretHash(initial), secretHash(newSecret()), now + 1); // intentionally discard response
  await assert.rejects(
    f.refresh.rotate(secretHash(initial), secretHash(newSecret()), now + 2),
    rejectsCode('REFRESH_REUSE'),
  );
  await assert.rejects(
    f.refresh.rotate(secretHash(newSecret()), secretHash(newSecret()), now + 2),
    rejectsCode('INVALID_REFRESH'),
  );
  assert.equal(
    (await f.db.run((ctx) => f.sessions.findById(session.id, { context: ctx })))
      ?.revokedAt,
    now + 2,
  );
});
test('session projections exclude secrets, foreign revoke denies, scope and recent auth are enforced', async (t) => {
  const f = await fixture(t);
  await f.registered();
  const one = await f.local.login(f.uniqueEmail, pass, f.facts()),
    two = await f.local.login(f.uniqueEmail, pass, f.facts());
  const list = await f.manager.list(actor(one), now);
  assert.equal(list.length, 2);
  assert.ok(
    list.every((row) => !('secretHash' in row) && !('identityKey' in row)),
  );
  await assert.rejects(
    f.manager.revoke(actor(one), 'selected', newId(), now),
    rejectsCode('SESSION_NOT_FOUND'),
  );
  await assert.rejects(
    f.manager.revoke(actor(one), 'all', undefined, now + 300001),
    rejectsCode('RECENT_AUTH_REQUIRED'),
  );
  await f.manager.revoke(actor(one), 'others', undefined, now + 1);
  assert.equal(
    (await f.db.run((ctx) => f.sessions.findById(one.id, { context: ctx })))
      ?.revokedAt,
    null,
  );
  assert.equal(
    (await f.db.run((ctx) => f.sessions.findById(two.id, { context: ctx })))
      ?.revokedAt,
    now + 1,
  );
  await f.manager.revoke(actor(one), 'current', undefined, now + 2);
  await assert.rejects(
    f.manager.list(actor(one), now + 2),
    rejectsCode('SESSION_REVOKED'),
  );
});
test('JWT rejection controls and current session authority override valid signed access', async (t) => {
  const f = await fixture(t);
  await f.registered();
  const session = await f.local.login(f.uniqueEmail, pass, f.facts());
  const claims = {
    accountId: session.accountId,
    sessionId: session.id,
    installationId: session.installationId,
    expiresAt: now + 60000,
    now,
  };
  const token = await f.tokens.issue(claims);
  const authority = new IdentityAuthority(
    f.db,
    f.accounts,
    f.installations,
    f.sessions,
    'local',
    [],
    f.tokens,
    null,
    () => now,
  );
  assert.equal(
    (await authority.verify({ kind: 'local', accessToken: token })).accountId,
    session.accountId,
  );
  for (const [issuer, audience, kid, algorithm, expires] of [
    ['wrong', 'test-api', 'local-v1', 'HS256', 60],
    ['test-issuer', 'wrong', 'local-v1', 'HS256', 60],
    ['test-issuer', 'test-api', 'wrong', 'HS256', 60],
    ['test-issuer', 'test-api', 'local-v1', 'HS384', 60],
    ['test-issuer', 'test-api', 'local-v1', 'HS256', -1],
  ] as const) {
    const forged = await new SignJWT({
      sid: session.id,
      iid: session.installationId,
    })
      .setProtectedHeader({ alg: algorithm, kid, typ: 'JWT' })
      .setSubject(session.accountId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now / 1000)
      .setExpirationTime(now / 1000 + expires)
      .sign(new TextEncoder().encode(jwtSecret));
    await assert.rejects(
      authority.verify({ kind: 'local', accessToken: forged }),
      rejectsCode('INVALID_ACCESS_TOKEN'),
    );
  }
  await f.manager.revoke(actor(session), 'current', undefined, now);
  await assert.rejects(
    authority.verify({ kind: 'local', accessToken: token }),
    rejectsCode('SESSION_REVOKED'),
  );
});
test('Firebase methods bind project+UID, preserve phone-only identity, and cutoff blocks stale reenrollment', async (t) => {
  const f = await fixture(t);
  const uid = newId();
  const enrollment = new FirebaseEnrollment(
    f.db,
    f.accounts,
    f.identities,
    f.issuer,
    'test-project',
    ['password', 'phone', 'google.com', 'apple.com'],
    300000,
  );
  const proof: FirebaseIdentity = {
    projectId: 'test-project',
    uid,
    method: 'phone',
    authenticatedAt: now - 1000,
    expiresAt: now + 3600000,
    email: null,
    emailVerified: false,
  };
  const oneFacts = f.facts(),
    twoFacts = f.facts();
  const [one, two] = await Promise.all([
    enrollment.enroll(proof, newId(), oneFacts),
    enrollment.enroll(proof, newId(), twoFacts),
  ]);
  assert.equal(one.accountId, two.accountId);
  assert.notEqual(one.id, two.id);
  assert.equal(
    (
      await f.db.run((ctx) =>
        f.accounts.findById(one.accountId, { context: ctx }),
      )
    )?.email,
    null,
  );
  const verifier: FirebaseVerifier = {
    async verify() {
      return proof;
    },
    async assertCurrent() {},
  };
  const authority = new IdentityAuthority(
    f.db,
    f.accounts,
    f.installations,
    f.sessions,
    'firebase',
    ['password', 'phone', 'google.com', 'apple.com'],
    null,
    verifier,
    () => now,
  );
  // Only the plaintext matching the stored capability can authenticate; a session UUID cannot.
  await assert.rejects(
    authority.verify({
      kind: 'firebase',
      idToken: 'test-only-fake',
      sessionSecret: newSecret(),
    }),
    rejectsCode('UNAUTHENTICATED'),
  );
  await f.manager.revoke(actor(one), 'current', undefined, now);
  await assert.rejects(
    enrollment.enroll(proof, newId(), f.facts(now + 1)),
    rejectsCode('REAUTHENTICATION_REQUIRED'),
  );
  assert.equal((await authority.current(two.id)).sessionId, two.id);
  const renewed = await enrollment.enroll(
    { ...proof, authenticatedAt: now + 1000 },
    newId(),
    f.facts(now + 1000),
  );
  assert.equal(renewed.accountId, one.accountId);
  for (const method of ['password', 'google.com', 'apple.com'])
    assert.ok(
      await enrollment.enroll(
        { ...proof, uid: newId(), method },
        newId(),
        f.facts(),
      ),
    );
  await assert.rejects(
    enrollment.enroll({ ...proof, method: 'anonymous' }, newId(), f.facts()),
    rejectsCode('PROVIDER_DISALLOWED'),
  );
  await assert.rejects(
    enrollment.enroll(
      { ...proof, projectId: 'foreign-project' },
      newId(),
      f.facts(),
    ),
    rejectsCode('PROVIDER_DISALLOWED'),
  );
  await assert.rejects(
    enrollment.enroll(
      { ...proof, authenticatedAt: now - 300001 },
      newId(),
      f.facts(),
    ),
    rejectsCode('RECENT_AUTH_REQUIRED'),
  );
});
test('Firebase capability pairs with matching verified UID; denied methods and unavailable provider remain distinct', async (t) => {
  const f = await fixture(t),
    secret = newSecret();
  const proof: FirebaseIdentity = {
    projectId: 'p',
    uid: newId(),
    method: 'google.com',
    authenticatedAt: now,
    expiresAt: now + 60000,
    email: email,
    emailVerified: true,
  };
  const enrollment = new FirebaseEnrollment(
    f.db,
    f.accounts,
    f.identities,
    f.issuer,
    'p',
    ['google.com'],
    300000,
  );
  const session = await enrollment.enroll(
    proof,
    newId(),
    sessionFacts(now, 3600, 'web', secret),
  );
  let verified = proof;
  const verifier: FirebaseVerifier = {
    async verify() {
      return verified;
    },
    async assertCurrent() {},
  };
  const authority = new IdentityAuthority(
    f.db,
    f.accounts,
    f.installations,
    f.sessions,
    'firebase',
    ['google.com'],
    null,
    verifier,
    () => now,
  );
  assert.equal(
    (
      await authority.verify({
        kind: 'firebase',
        idToken: 'test-only-fake',
        sessionSecret: secret,
      })
    ).sessionId,
    session.id,
  );
  verified = { ...proof, uid: newId() };
  await assert.rejects(
    authority.verify({
      kind: 'firebase',
      idToken: 'test-only-fake',
      sessionSecret: secret,
    }),
    rejectsCode('UNAUTHENTICATED'),
  );
  verified = { ...proof, method: 'password' };
  await assert.rejects(
    authority.verify({
      kind: 'firebase',
      idToken: 'test-only-fake',
      sessionSecret: secret,
    }),
    rejectsCode('PROVIDER_DISALLOWED'),
  );
  const unavailable: FirebaseVerifier = {
    async verify() {
      const error = Object.assign(new Error('unavailable'), {
        code: 'FIREBASE_UNAVAILABLE',
      });
      throw error;
    },
    async assertCurrent() {
      throw Object.assign(new Error('unavailable'), {
        code: 'FIREBASE_UNAVAILABLE',
      });
    },
  };
  const offline = new IdentityAuthority(
    f.db,
    f.accounts,
    f.installations,
    f.sessions,
    'firebase',
    ['google.com'],
    null,
    unavailable,
    () => now,
  );
  await assert.rejects(
    offline.current(session.id),
    rejectsCode('FIREBASE_UNAVAILABLE'),
  );
  const forbidden = new IdentityAuthority(
    f.db,
    f.accounts,
    f.installations,
    f.sessions,
    'firebase',
    [],
    null,
    verifier,
    () => now,
  );
  await assert.rejects(
    forbidden.current(session.id),
    rejectsCode('PROVIDER_DISALLOWED'),
  );
});
test('durable per-identity limits survive multiple limiter instances and rollback contexts cannot leak', async (t) => {
  const f = await fixture(t),
    key = secretHash(newSecret());
  const a = new IdentityRateLimits(f.db, f.identities),
    b = new IdentityRateLimits(f.db, f.identities);
  await a.spend([{ key, limit: 2 }], now);
  await b.spend([{ key, limit: 2 }], now);
  await assert.rejects(
    a.spend([{ key, limit: 2 }], now),
    rejectsCode('RATE_LIMITED'),
  );
  await a.spend([{ key, limit: 2 }], now + 60000);
  await assert.rejects(
    b.spend([{ key, limit: 2 }], now),
    rejectsCode('RATE_LIMITED'),
  );
  await b.spend([{ key, limit: 2 }], now + 60000);
  await assert.rejects(
    a.spend([{ key, limit: 2 }], now + 60000),
    rejectsCode('RATE_LIMITED'),
  );
  const concurrentKey = secretHash(newSecret());
  const spends = await Promise.allSettled([
    a.spend([{ key: concurrentKey, limit: 1 }], now),
    b.spend([{ key: concurrentKey, limit: 1 }], now),
  ]);
  assert.equal(spends.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    spends.filter(
      (r) => r.status === 'rejected' && rejectsCode('RATE_LIMITED')(r.reason),
    ).length,
    1,
  );
  const otherFixture = await postgresFixture(t);
  await assert.rejects(
    f.db.run(async (ctx) => otherFixture.database.context(ctx)),
    rejectsCode('INVALID_TRANSACTION_CONTEXT'),
  );
});
policyTest(
  'real bounded Argon2id verifies Unicode and JWT input schemas reject excessive/owner fields',
  async () => {
    const passwords = await ArgonPasswords.create();
    const value = 'a long Unicode password 🔐';
    const hash = await passwords.hash(value);
    assert.ok(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'));
    assert.equal(await passwords.verify(hash, value), true);
    assert.equal(await passwords.verify(hash, value + 'x'), false);
    assert.equal(passwords.needsRehash(hash), false);
    assert.ok(passwords.measuredHashMs > 0);
    const jobs = await Promise.allSettled([
      passwords.hash(value),
      passwords.hash(value),
      passwords.hash(value),
    ]);
    assert.equal(jobs.filter((r) => r.status === 'fulfilled').length, 2);
    assert.ok(
      jobs.some(
        (r) =>
          r.status === 'rejected' && rejectsCode('HASH_CAPACITY')(r.reason),
      ),
    );
    assert.equal(password.safeParse('🔐'.repeat(100)).success, false);
    assert.equal(
      credentials.safeParse({ email: email.toUpperCase(), password: pass }).data
        ?.email,
      email,
    );
    assert.equal(
      credentials.safeParse({ email, password: pass, accountId: newId() })
        .success,
      false,
    );
    const token = newSecret();
    assert.equal(
      verificationInput.safeParse({ token, password: pass }).success,
      true,
    );
    for (const body of [
      undefined,
      null,
      'invalid body',
      {},
      { token },
      { token, password: 123 },
      { token, password: 'too short' },
      { token: 'invalid capability', password: pass },
      { token, password: '🔐'.repeat(100) },
      { token, password: pass, accountId: newId() },
    ])
      assert.equal(verificationInput.safeParse(body).success, false);
  },
);

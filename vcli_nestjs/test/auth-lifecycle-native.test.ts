import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createClient } from '@redis/client';
import { identityFixture } from './auth-lifecycle-fixture.ts';

/** Root supplies an already migrated, isolated URL; this suite never provisions or migrates. */
for (const database of ['mongodb', 'postgres'] as const) {
  const url =
    process.env[`VCLI_IDENTITY_${database.toUpperCase()}_TEST_URL`] ??
    (process.env.VCLI_IDENTITY_TEST_DATABASE === database
      ? process.env.TEST_DATABASE_URL
      : undefined);
  for (const profile of ['local', 'firebase'] as const) {
    test(
      `native ${database}/${profile}: prepared-schema lifecycle with synthetic provider only`,
      { skip: !url },
      async () => {
        const load = await identityFixture(database);
        const {
          [database === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase']:
            NativeDatabase,
        } = await load(
          `core/database/${database === 'mongodb' ? 'mongo' : 'postgres'}-database`,
        );
        const db = await NativeDatabase.connect(url, true);
        try {
          const { AccountService } = await load(
            'modules/accounts/account.service',
          );
          const { IdentityService } = await load(
            'modules/identity/identity.service',
          );
          const { InstallationService } = await load(
            'modules/installations/installation.service',
          );
          const { SessionService } = await load(
            'modules/sessions/session.service',
          );
          const { SessionIssuer } = await load(
            'modules/sessions/session-issuer.service',
          );
          const { IdentityAuthority } = await load(
            'modules/identity/identity-authority.service',
          );
          const { SessionManagement } = await load(
            'modules/sessions/session-management.service',
          );
          const { ProviderCleanupService } = await load(
            'modules/identity/provider-cleanup.service',
          );
          const { FreshIdentityProof } = await load(
            'modules/identity/fresh-identity-proof.service',
          );
          const { AccountLifecycle } = await load(
            'modules/identity/account-lifecycle.service',
          );
          const { InstallationLifecycle } = await load(
            'modules/identity/installation-lifecycle.service',
          );
          const facts = await load('modules/identity/secret-facts');
          const accounts = new AccountService(db),
            identities = new IdentityService(db),
            installations = new InstallationService(db),
            sessions = new SessionService(db),
            cleanup = new ProviderCleanupService(db);
          const issuer = new SessionIssuer(accounts, installations, sessions);
          const management = new SessionManagement(
            db,
            accounts,
            identities,
            installations,
            sessions,
            60000,
          );
          const now = Date.now(),
            marker = randomUUID(),
            device = facts.newSecret();
          let freshAt = now - 1000;
          const providerProof = () => ({
            projectId: 'synthetic-lifecycle',
            uid: marker,
            method: 'google.com',
            linkedMethods: ['google.com', 'phone'],
            authenticatedAt: freshAt,
            expiresAt: now + 3600000,
            email: null,
            emailVerified: false,
          });
          const verifier = {
            async verify() {
              return providerProof();
            },
            async assertCurrent() {},
          };
          const methods = ['password', 'phone', 'google.com', 'apple.com'];
          const { ArgonPasswords } = await load(
            'modules/identity/argon-passwords.service',
          );
          const passwords =
            profile === 'local' ? await ArgonPasswords.create() : null;
          const fresh = new FreshIdentityProof(
            db,
            accounts,
            identities,
            installations,
            sessions,
            passwords,
            profile === 'firebase' ? verifier : null,
            methods,
            60000,
          );
          const authority = new IdentityAuthority(
            db,
            accounts,
            installations,
            sessions,
            profile,
            methods,
            null,
            profile === 'firebase' ? verifier : null,
            () => now,
          );
          const accountId = randomUUID(),
            email = `${marker}@example.invalid`,
            password = 'native-owner-password-123';
          let current, independent;
          if (profile === 'firebase') {
            const { FirebaseEnrollment } = await load(
              'modules/identity/firebase-enrollment.service',
            );
            const enrollment = new FirebaseEnrollment(
              db,
              accounts,
              identities,
              issuer,
              'synthetic-lifecycle',
              methods,
              60000,
            );
            const capability = facts.newSecret();
            const enroll = (
              secret = capability,
              install = device,
              at = now,
              allow = false,
            ) =>
              enrollment.enroll(
                providerProof(),
                randomUUID(),
                facts.sessionFacts(
                  at,
                  3600,
                  'web',
                  secret,
                  install,
                  'firebase',
                  allow,
                ),
              );
            const raced = await Promise.all(
              Array.from({ length: 4 }, () => enroll()),
            );
            assert.equal(new Set(raced.map((row) => row.id)).size, 1);
            current = raced[0];
            assert.equal(
              (await enroll(capability, device, now + 120000)).id,
              current.id,
              'lost response and aged authentication recover one enrollment',
            );
            let reportUnknown = true;
            const uncertain = {
              async run(work: (ctx: object) => Promise<unknown>) {
                const result = await db.run(work);
                if (reportUnknown) {
                  reportUnknown = false;
                  throw Object.assign(new Error('COMMIT_OUTCOME_UNKNOWN'), {
                    code: 'COMMIT_OUTCOME_UNKNOWN',
                  });
                }
                return result;
              },
            };
            const recoverable = new FirebaseEnrollment(
                uncertain,
                accounts,
                identities,
                issuer,
                'synthetic-lifecycle',
                methods,
                60000,
              ),
              lost = facts.sessionFacts(
                now,
                3600,
                'web',
                facts.newSecret(),
                facts.newSecret(),
                'firebase',
              );
            await assert.rejects(
              recoverable.enroll(providerProof(), randomUUID(), lost),
              { code: 'COMMIT_OUTCOME_UNKNOWN' },
            );
            assert.ok(
              (await recoverable.enroll(providerProof(), randomUUID(), lost))
                .id,
            );
            independent = await enroll(facts.newSecret(), facts.newSecret());
          } else {
            const { LocalCredentials } = await load(
              'modules/identity/local-credentials.service',
            );
            const { ActionTokens } = await load(
              'modules/identity/action-tokens.service',
            );
            const { RefreshSessions } = await load(
              'modules/sessions/refresh-sessions.service',
            );
            const local = new LocalCredentials(
              db,
              accounts,
              identities,
              passwords,
              issuer,
            );
            await local.register(email, password, accountId, now);
            const action = facts.capabilityHash(
              facts.newSecret(),
              'action-token',
            );
            const actions = new ActionTokens(
              db,
              accounts,
              identities,
              sessions,
              passwords,
              {
                async submit() {
                  return { status: 'captured', captureId: randomUUID() };
                },
              },
            );
            await actions.request(email, 'verification', action, now, {
              operationId: randomUUID(),
              to: email,
              subject: 'Controlled verification',
              text: 'Private synthetic provider action',
              purpose: 'verification',
            });
            const confirmed = await Promise.allSettled([
              actions.confirm(action, 'verification', now, password),
              actions.confirm(
                action,
                'verification',
                now,
                'competing-password-123',
              ),
            ]);
            assert.equal(
              confirmed.filter((row) => row.status === 'fulfilled').length,
              1,
            );
            // The winning confirmation is deliberately not assumed by index under real DB concurrency.
            const chosen = await db.run((ctx: object) =>
              identities.find('local:' + email, ctx),
            );
            const actualPassword = (await passwords.verify(
              chosen.passwordHash,
              password,
            ))
              ? password
              : 'competing-password-123';
            const firstToken = facts.newSecret();
            current = await local.login(
              email,
              actualPassword,
              facts.sessionFacts(now, 3600, 'web', firstToken, device),
            );
            const refresh = new RefreshSessions(
                db,
                accounts,
                installations,
                sessions,
              ),
              hash = facts.capabilityHash(firstToken, 'refresh-token');
            const race = await Promise.allSettled([
              refresh.rotate(
                hash,
                facts.capabilityHash(facts.newSecret(), 'refresh-token'),
                now,
              ),
              refresh.rotate(
                hash,
                facts.capabilityHash(facts.newSecret(), 'refresh-token'),
                now,
              ),
            ]);
            assert.equal(
              race.filter((row) => row.status === 'fulfilled').length,
              1,
            );
            assert.notEqual(
              (await sessions.findById(current.id)).revokedAt,
              null,
            );
            current = await local.login(
              email,
              actualPassword,
              facts.sessionFacts(now, 3600, 'web', facts.newSecret(), device),
            );
            independent = await local.login(
              email,
              actualPassword,
              facts.sessionFacts(
                now,
                3600,
                'web',
                facts.newSecret(),
                facts.newSecret(),
              ),
            );
            await assert.rejects(
              refresh.rotate(
                hash,
                facts.capabilityHash(facts.newSecret(), 'refresh-token'),
                now,
              ),
              { code: 'REFRESH_REUSE' },
            );
            assert.equal(
              (await sessions.findById(independent.id)).revokedAt,
              null,
            );
            // The lifecycle proof must use the credential actually established by the proof race.
            Object.assign(verifier, { localPassword: actualPassword });
          }
          const actor = await authority.current(current.id);
          const list = await management.list(actor, now);
          assert.ok(list.length >= 2);
          assert.equal(JSON.stringify(list).includes('secretHash'), false);
          await management.revoke(actor, 'selected', independent.id, now);
          assert.equal((await sessions.findById(current.id)).revokedAt, null);
          assert.notEqual(
            (await sessions.findById(independent.id)).revokedAt,
            null,
          );
          if (profile === 'firebase') freshAt = now + 1;
          const self =
            profile === 'firebase'
              ? { idToken: 'synthetic-owned-token' }
              : { password: Reflect.get(verifier, 'localPassword') };
          const lifecycle = new InstallationLifecycle(
            db,
            installations,
            sessions,
            fresh,
          );
          const nextDevice = facts.newSecret();
          const rotated = await lifecycle.rotate(
            actor,
            self,
            device,
            nextDevice,
            now + 1,
          );
          assert.equal(
            rotated.installationGeneration,
            current.installationGeneration + 1,
          );
          await assert.rejects(authority.current(current.id), {
            code: 'SESSION_REVOKED',
          });
          // A real native rollback must not retain any action row from a failed participant.
          const rollbackHash = facts.capabilityHash(
            facts.newSecret(),
            'action-token',
          );
          await assert.rejects(
            db.run(async (ctx: object) => {
              await identities.addAction(
                {
                  hash: rollbackHash,
                  accountId: actor.accountId,
                  purpose: 'password-reset',
                  credentialVersion: 1,
                  expiresAt: now + 60000,
                  consumedAt: null,
                },
                ctx,
              );
              throw new Error('CONTROLLED_PARTICIPANT_ROLLBACK');
            }),
          );
          assert.equal(
            await db.run((ctx: object) =>
              identities.consumeAction(
                rollbackHash,
                'password-reset',
                now,
                ctx,
              ),
            ),
            null,
          );
          // Reauthentication with the proved rotated installation allows explicit identity deletion.
          let final;
          if (profile === 'firebase') {
            const { FirebaseEnrollment } = await load(
              'modules/identity/firebase-enrollment.service',
            );
            final = await new FirebaseEnrollment(
              db,
              accounts,
              identities,
              issuer,
              'synthetic-lifecycle',
              methods,
              60000,
            ).enroll(
              providerProof(),
              randomUUID(),
              facts.sessionFacts(
                now + 1,
                3600,
                'web',
                facts.newSecret(),
                nextDevice,
                'firebase',
              ),
            );
          } else {
            const { LocalCredentials } = await load(
              'modules/identity/local-credentials.service',
            );
            final = await new LocalCredentials(
              db,
              accounts,
              identities,
              passwords,
              issuer,
            ).login(
              email,
              self.password,
              facts.sessionFacts(
                now + 1,
                3600,
                'web',
                facts.newSecret(),
                nextDevice,
              ),
            );
          }
          const finalActor = await authority.current(final.id),
            accountsLifecycle = new AccountLifecycle(
              db,
              accounts,
              identities,
              sessions,
              fresh,
              profile === 'firebase' ? cleanup : null,
            );
          const deleted = await accountsLifecycle.act(
            finalActor,
            'delete',
            self,
            now + 1,
          );
          assert.equal(deleted.status, 'deleted-retained');
          assert.equal(
            (await accounts.findById(finalActor.accountId)).enabled,
            false,
          );
          if (profile === 'firebase') {
            const { ProviderCleanupDispatcher } = await load(
              'modules/identity/provider-cleanup-dispatcher.service',
            );
            let clock = now + 1,
              calls = 0;
            const provider = {
              async cleanup() {
                calls++;
                return calls === 1 ? 'retry' : 'completed';
              },
            };
            assert.equal(
              (
                await new ProviderCleanupDispatcher(
                  db,
                  identities,
                  cleanup,
                  provider,
                  () => clock,
                ).drain(1)
              ).completed,
              0,
            );
            clock += 3000;
            assert.equal(
              (
                await new ProviderCleanupDispatcher(
                  db,
                  identities,
                  cleanup,
                  provider,
                  () => clock,
                ).drain(1)
              ).completed,
              1,
            );
          }
        } finally {
          await db.close();
        }
      },
    );
  }
}

const redisUrl = process.env.VCLI_IDENTITY_REDIS_TEST_URL;
test(
  'native Redis identity limiter shares bounded, expiring budgets across scopes and processes',
  { skip: !redisUrl },
  async () => {
    assert.ok(redisUrl);
    const load = await identityFixture('postgres');
    const { RedisIdentityRateStore } = await load(
      'modules/identity/redis-identity-rate-store',
    );
    const { secretHash } = await load('modules/identity/secret-facts');
    const project = 'native-identity-' + randomUUID();
    const namespace = project + ':test';
    const namespaceHash = createHash('sha256').update(namespace).digest('hex');
    const key = (scope: string) =>
      `vcli:identity-rate:{${namespaceHash}}:${scope}`;
    const peerScope = { key: secretHash('peer'), limit: 3 };
    const accountScope = { key: secretHash('account'), limit: 5 };
    const sharedScope = { key: secretHash('shared'), limit: 3 };
    const rates = new RedisIdentityRateStore(redisUrl, namespace);
    const otherProject = new RedisIdentityRateStore(
      redisUrl,
      project + '-other:test',
    );
    const otherEnvironment = new RedisIdentityRateStore(
      redisUrl,
      project + ':development',
    );
    const observer = createClient({
      url: redisUrl,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    }).on('error', () => {});
    try {
      await observer.connect().catch(() => {
        throw new Error('NATIVE_RATE_OBSERVER_CONNECT_FAILED');
      });
      const time = await observer.sendCommand(['TIME']);
      assert.ok(Array.isArray(time));
      const remainingMs =
        60000 - (Number(time[0]) % 60) * 1000 - Number(time[1]) / 1000;
      if (remainingMs < 8000) await setTimeout(remainingMs + 50);

      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () => rates.spend([peerScope, accountScope])),
      );
      assert.equal(
        attempts.filter((row) => row.status === 'fulfilled').length,
        3,
      );
      for (const attempt of attempts)
        if (attempt.status === 'rejected') {
          assert.equal(attempt.reason.code, 'RATE_LIMITED');
          assert.equal(attempt.reason.status, 429);
        }
      await assert.rejects(rates.spend([accountScope]), {
        code: 'RATE_LIMITED',
        status: 429,
      });
      assert.deepEqual(
        await observer.mGet([key(peerScope.key), key(accountScope.key)]),
        ['3', '5'],
      );
      const [peerTtl, accountTtl] = await Promise.all([
        observer.pTTL(key(peerScope.key)),
        observer.pTTL(key(accountScope.key)),
      ]);
      assert.ok(peerTtl > 0 && peerTtl <= 60000);
      assert.ok(accountTtl > 0 && Math.abs(peerTtl - accountTtl) <= 10);
      await Promise.all([
        otherProject.spend([peerScope]),
        otherEnvironment.spend([peerScope]),
      ]);

      const childSource = `
        const {RedisIdentityRateStore} = await import(process.env.VCLI_IDENTITY_RATE_STORE_MODULE);
        const store = new RedisIdentityRateStore(process.env.VCLI_IDENTITY_REDIS_TEST_URL, process.env.VCLI_IDENTITY_RATE_NAMESPACE);
        let accepted = 0;
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await store.spend([{key: process.env.VCLI_IDENTITY_RATE_KEY, limit: 3}]);
              accepted++;
            } catch (error) {
              if (error.code !== 'RATE_LIMITED' || error.status !== 429) throw error;
            }
          }
          process.stdout.write(String(accepted));
        } finally {
          store.close();
        }
      `;
      const peer = () =>
        new Promise<number>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['--input-type=module', '-e', childSource],
            {
              env: {
                ...process.env,
                VCLI_IDENTITY_RATE_STORE_MODULE: pathToFileURL(
                  join(
                    load.directory,
                    'out/modules/identity/redis-identity-rate-store.js',
                  ),
                ).href,
                VCLI_IDENTITY_RATE_NAMESPACE: namespace,
                VCLI_IDENTITY_RATE_KEY: sharedScope.key,
              },
              stdio: ['ignore', 'pipe', 'ignore'],
              timeout: 5000,
            },
          );
          let output = '';
          child.stdout.on('data', (chunk) => {
            output += String(chunk);
          });
          child.on('error', () =>
            reject(new Error('NATIVE_RATE_PEER_START_FAILED')),
          );
          child.on('close', (code) => {
            if (code === 0 && /^[0-2]$/u.test(output)) resolve(Number(output));
            else reject(new Error('NATIVE_RATE_PEER_FAILED'));
          });
        });
      assert.equal(
        (await Promise.all([peer(), peer()])).reduce(
          (total, value) => total + value,
          0,
        ),
        3,
      );
      await assert.rejects(rates.spend([sharedScope]), {
        code: 'RATE_LIMITED',
        status: 429,
      });
    } finally {
      rates.close();
      otherProject.close();
      otherEnvironment.close();
      if (observer.isOpen) observer.destroy();
    }
  },
);

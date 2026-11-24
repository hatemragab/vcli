import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ReleaseManifest,
  ReleaseStore,
  ReleaseOwner,
} from '../templates/runtime/common/src/release/release-types.js';
import type {
  BackupProfile,
  RestoreProfile,
} from '../templates/runtime/common/src/release/backup-types.js';
import type { NativeCommandRunner } from '../templates/runtime/common/src/release/native-command.js';
import {
  releaseFixture,
  releaseFixtureRoot,
  type NativeStoreModule,
  type NativeBackupModule,
  type NativeProofAccess,
} from './release-fixture.ts';
type Coordinator =
  typeof import('../templates/runtime/common/src/release/release-coordinator.js');
type Validation =
  typeof import('../templates/runtime/common/src/release/release-validation.js');
type Backup =
  typeof import('../templates/runtime/common/src/release/backup.service.js');
type NativeCommandModule =
  typeof import('../templates/runtime/common/src/release/native-command.js');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

// Root supplies disposable, empty databases and matching native tools; this suite never provisions them.
for (const database of ['postgres', 'mongodb'] as const) {
  const url =
    process.env[`VCLI_RELEASE_${database.toUpperCase()}_TEST_URL`] ??
    (process.env.VCLI_RELEASE_TEST_DATABASE === database
      ? process.env.TEST_DATABASE_URL
      : undefined);
  const restoreUrl =
    process.env[`VCLI_RELEASE_${database.toUpperCase()}_RESTORE_URL`] ??
    (process.env.VCLI_RELEASE_TEST_DATABASE === database
      ? process.env.TEST_RESTORE_DATABASE_URL
      : undefined);
  test(
    `native ${database}: concurrency, preserving partial release, lost acknowledgement, orphan fence/restart and isolated restore`,
    {
      skip: !url ? 'root-owned TEST_DATABASE_URL not supplied' : false,
      timeout: 120000,
    },
    async (t) => {
      const load = await releaseFixture(database),
        { ReleaseCoordinator } = await load<Coordinator>('release-coordinator'),
        { assertLedgerReady } = await load<Validation>('release-validation'),
        { NativeReleaseStore } = await load<NativeStoreModule>(
          'native-release-store',
        ),
        access = await load<NativeProofAccess>('proof-access');
      let store = await NativeReleaseStore.connect(url!);
      const competing = await NativeReleaseStore.connect(url!);
      let resume = () => {};
      try {
        // A fresh disposable source makes the native history assertions unambiguous.
        assert.equal(
          await store.read(),
          null,
          'supply a fresh isolated source database',
        );
        const suffix = randomUUID(),
          rowId = 'seed-' + suffix;
        const plan: ReleaseManifest = {
          schema: 1,
          id: 'native-proof-' + suffix,
          components: [
            {
              component: 'proof-seed',
              version: 1,
              digest: sha('native-preserving-seed-v1'),
            },
            {
              component: 'proof-later',
              version: 1,
              digest: sha('native-partial-v1'),
            },
          ],
        };
        let seedCalls = 0,
          laterCalls = 0,
          fail = true;
        const owners: ReleaseOwner[] = [
          {
            component: 'proof-seed',
            apply: async () => {
              seedCalls++;
              await access.seed(url!, rowId);
            },
          },
          {
            component: 'proof-later',
            apply: async () => {
              laterCalls++;
              if (fail)
                throw new Error('controlled callback after native prior owner');
            },
          },
        ];
        let coordinator = new ReleaseCoordinator(store);
        await assert.rejects(
          coordinator.apply(plan, owners),
          /OUTCOME_UNKNOWN/,
        );
        let ledger = (await store.read())!;
        assert.equal(ledger.attempts[0]?.status, 'completed');
        assert.equal(ledger.attempts[1]?.status, 'unknown');
        assert.equal(await access.read(url!, rowId), 'preserved-private-row');
        await assert.rejects(coordinator.apply(plan, owners), /RECONCILIATION/);
        await coordinator.reconcile(plan, {
          quiesced: true,
          expectedHolder: ledger.holder,
          expectedFence: (await store.read())!.fence,
          evidence: 'test:inspected-native-owner',
          attemptId: ledger.attempts[1]!.id,
          decision: 'retry',
        });
        fail = false;
        await coordinator.apply(plan, owners);
        await coordinator.apply(plan, owners);
        assert.equal(seedCalls, 1);
        assert.equal(laterCalls, 2);
        assertLedgerReady(await store.read(), plan);
        let started = () => {};
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const hold = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const next: ReleaseManifest = {
          ...plan,
          id: 'native-concurrent-' + suffix,
          components: [
            ...plan.components,
            {
              component: 'proof-concurrent',
              version: 1,
              digest: sha('native-gate-v1'),
            },
          ],
        };
        const nextOwners = [
          ...owners,
          {
            component: 'proof-concurrent',
            apply: async () => {
              started();
              await hold;
            },
          },
        ];
        const running = coordinator.apply(next, nextOwners);
        await ready;
        try {
          await assert.rejects(
            new ReleaseCoordinator(competing).apply(next, nextOwners),
            /BUSY|RECONCILIATION/,
          );
        } finally {
          resume();
          await running;
        }
        assertLedgerReady(await store.read(), next);
        const ack: ReleaseManifest = {
          ...next,
          id: 'native-ack-' + suffix,
          components: [
            ...next.components,
            {
              component: 'proof-ack',
              version: 1,
              digest: sha('native-ack-v1'),
            },
          ],
        };
        let ackLost = false,
          ackCalls = 0;
        const ackStore: ReleaseStore = {
          acquire: (recovery) => store.acquire(recovery),
          read: () => store.read(),
          release: (session) => store.release(session),
          close: async () => {},
          change: async (session, update) => {
            let completing = false;
            await store.change(session, (ledger) => {
              const before = ledger.attempts.find(
                (item) => item.component === 'proof-ack',
              )?.status;
              update(ledger);
              completing =
                before === 'incomplete' &&
                ledger.attempts.find((item) => item.component === 'proof-ack')
                  ?.status === 'completed';
            });
            if (completing && !ackLost) {
              ackLost = true;
              throw new Error(
                'controlled lost acknowledgement after native commit',
              );
            }
          },
        };
        const ackOwners = [
          ...nextOwners,
          {
            component: 'proof-ack',
            apply: async () => {
              ackCalls++;
            },
          },
        ];
        await assert.rejects(
          new ReleaseCoordinator(ackStore).apply(ack, ackOwners),
          /OUTCOME_UNKNOWN/,
        );
        await coordinator.apply(ack, ackOwners);
        assert.equal(ackCalls, 1);
        const abandoned = await store.acquire();
        await store.close();
        store = await NativeReleaseStore.connect(url!);
        coordinator = new ReleaseCoordinator(store);
        await assert.rejects(
          coordinator.apply(ack, ackOwners),
          /BUSY|RECONCILIATION/,
        );
        await assert.rejects(
          coordinator.reconcile(ack, {
            quiesced: true,
            expectedHolder: abandoned.token,
            expectedFence: abandoned.fence - 1,
            evidence: 'test:stale-stopped-runner',
          }),
          /STALE/,
        );
        await coordinator.reconcile(ack, {
          quiesced: true,
          expectedHolder: abandoned.token,
          expectedFence: abandoned.fence,
          evidence: 'test:closed-old-native-runner',
        });
        await coordinator.apply(ack, ackOwners);
        ledger = (await store.read())!;
        assertLedgerReady(ledger, ack);
        assert.equal(await access.read(url!, rowId), 'preserved-private-row');
        await assert.rejects(
          coordinator.apply(
            {
              ...ack,
              components: [
                { ...ack.components[0]!, digest: sha('tamper') },
                ...ack.components.slice(1),
              ],
            },
            ackOwners,
          ),
          /IDENTITY_MISMATCH/,
        );

        await t.test(
          'actual native dump and isolated restore: known database row plus exact private bytes',
          {
            skip: !restoreUrl
              ? 'root-owned TEST_RESTORE_DATABASE_URL not supplied'
              : process.env.VCLI_RELEASE_NATIVE_TOOLS !== '1'
                ? 'matching native tools not enabled by root'
                : false,
            timeout: 90000,
          },
          async () => {
            const { NativeBackup } =
                await load<NativeBackupModule>('native-backup'),
              { BackupService } = await load<Backup>('backup.service'),
              { runNativeCommand } =
                await load<NativeCommandModule>('native-command');
            const wrapper = process.env.VCLI_RELEASE_TOOL_WRAPPER;
            const runner: NativeCommandRunner = (command) =>
              runNativeCommand(
                wrapper
                  ? {
                      ...command,
                      executable: wrapper,
                      args: [command.executable, ...command.args],
                    }
                  : command,
              );
            const parent = join(
              releaseFixtureRoot,
              'native-proof',
              database + '-' + suffix,
            );
            await mkdir(parent, { recursive: true, mode: 0o700 });
            for (const child of ['keys', 'work', 'archives', 'media'])
              await mkdir(join(parent, child), { mode: 0o700 });
            const key = join(parent, 'keys', 'backup.key');
            await writeFile(key, randomBytes(32), { mode: 0o600 });
            const privateBytes = randomBytes(4096);
            await writeFile(join(parent, 'media', 'seeded.bin'), privateBytes, {
              mode: 0o600,
            });
            const profile: BackupProfile = {
              schema: 1,
              id: 'native-snapshot-' + suffix,
              quiesced: true,
              quiescenceRef: 'test:all-native-fixture-writers-stopped',
              databaseResourceId: 'fixture:source',
              archiveDirectory: join(parent, 'archives', 'snapshot'),
              workDirectory: join(parent, 'work'),
              encryptionKeyPath: key,
              encryptionKeyId: 'fixture:archive-key',
              maximumBytes: 64 * 1024 * 1024,
              maximumFiles: 100,
              localRoots: [{ id: 'media', path: join(parent, 'media') }],
              externalSnapshots: [],
              policy: {
                accessPolicyRef: 'fixture:private-operator',
                retentionUntil: '2100-01-01T00:00:00.000Z',
                secretSourceRefs: ['database.credentials'],
                historicalMailKeyIds: [],
              },
            };
            try {
              const service = new BackupService(new NativeBackup(runner));
              await service.create(url!, ack, profile, {
                localRoots: profile.localRoots,
                externalResources: [],
                secretSourceRefs: ['database.credentials'],
              });
              const restore: RestoreProfile = {
                schema: 1,
                isolated: true,
                targetEnvironment: 'isolated',
                quiesced: true,
                quiescenceRef: 'test:isolated-target-no-writers',
                archiveDirectory: profile.archiveDirectory,
                workDirectory: profile.workDirectory,
                encryptionKeyPath: key,
                encryptionKeyId: profile.encryptionKeyId,
                targetDatabaseUrl: restoreUrl!,
                targetDatabaseResourceId: 'fixture:restore',
                protectedDatabaseNames: [new URL(url!).pathname.slice(1)],
                localRoots: [
                  { id: 'media', path: join(parent, 'restored-media') },
                ],
                maximumBytes: profile.maximumBytes,
                maximumFiles: profile.maximumFiles,
                availableSecretSourceRefs: profile.policy.secretSourceRefs,
                availableHistoricalMailKeyIds: [],
                externalSnapshotAccessRefs: [],
              };
              assert.equal(
                (await service.restore(restore)).status,
                'restored-unverified',
              );
              assert.equal(
                await access.read(restoreUrl!, rowId),
                'preserved-private-row',
              );
              assert.equal(
                (
                  await readFile(join(parent, 'restored-media', 'seeded.bin'))
                ).equals(privateBytes),
                true,
                'isolated private object bytes match',
              );
              assert.equal(
                await access.read(url!, rowId),
                'preserved-private-row',
              );
              // Explicit application/provider/key-decryption acceptance stays root-owned beyond these row/byte assertions.
              await assert.rejects(
                service.restore({
                  ...restore,
                  localRoots: [
                    {
                      id: 'media',
                      path: join(parent, 'another-restored-media'),
                    },
                  ],
                }),
                /NOT_EMPTY/,
              );
            } finally {
              await rm(parent, { recursive: true, force: true });
            }
          },
        );
      } finally {
        resume();
        await competing.close();
        await store.close();
      }
    },
  );
}

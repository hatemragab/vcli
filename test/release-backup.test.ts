import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  stat,
  symlink,
  chmod,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type {
  BackupProfile,
  RestoreProfile,
  NativeBackupOperations,
} from '../templates/runtime/common/src/release/backup-types.js';
import type { ReleaseManifest } from '../templates/runtime/common/src/release/release-types.js';
import type {
  NativeCommand,
  NativeCommandRunner,
} from '../templates/runtime/common/src/release/native-command.js';
import {
  releaseFixture,
  releaseFixtureRoot,
  type NativeBackupModule,
} from './release-fixture.ts';
type Backup =
  typeof import('../templates/runtime/common/src/release/backup.service.js');
type PrivateFiles =
  typeof import('../templates/runtime/common/src/release/private-files.js');
type Validation =
  typeof import('../templates/runtime/common/src/release/backup-validation.js');
const plan: ReleaseManifest = {
  schema: 1,
  id: 'backup-release-v1',
  components: [],
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fakeDescribe = (url: string) => ({
  name: new URL(url).pathname.slice(1),
  identity: sha(new URL(url).host + new URL(url).pathname),
});
const sourceUrl =
  'postgresql://fixture:private-password@127.0.0.1/source_fixture';
async function layout() {
  const parent = join(releaseFixtureRoot, 'backup-cases', randomUUID());
  await mkdir(parent, { recursive: true, mode: 0o700 });
  for (const directory of ['work', 'media', 'archives', 'keys'])
    await mkdir(join(parent, directory), { mode: 0o700 });
  const key = join(parent, 'keys', 'archive.key');
  await writeFile(key, randomBytes(32), { mode: 0o600 });
  const source = join(parent, 'media');
  await mkdir(join(source, 'empty'), { mode: 0o700 });
  await mkdir(join(source, 'private'), { mode: 0o700 });
  await writeFile(
    join(source, 'private', 'object.bin'),
    Buffer.from([0, 1, 2, 255, 4, 5]),
    { mode: 0o600 },
  );
  const profile: BackupProfile = {
    schema: 1,
    id: 'backup-proof',
    quiesced: true,
    quiescenceRef: 'ticket:stopped-all-writers',
    databaseResourceId: 'db:source',
    archiveDirectory: join(parent, 'archives', 'snapshot'),
    workDirectory: join(parent, 'work'),
    encryptionKeyPath: key,
    encryptionKeyId: 'key:backup-v1',
    maximumBytes: 1024 * 1024,
    maximumFiles: 100,
    localRoots: [{ id: 'media', path: source }],
    externalSnapshots: [],
    policy: {
      accessPolicyRef: 'acl:private-backup-operators',
      retentionUntil: '2100-01-01T00:00:00.000Z',
      secretSourceRefs: ['database.credentials', 'mail.delivery-key-ring'],
      historicalMailKeyIds: ['mail-old-key', 'mail-current-key'],
    },
  };
  const restore: RestoreProfile = {
    schema: 1,
    isolated: true,
    targetEnvironment: 'isolated',
    quiesced: true,
    quiescenceRef: 'ticket:isolated-no-writers',
    archiveDirectory: profile.archiveDirectory,
    workDirectory: profile.workDirectory,
    encryptionKeyPath: key,
    encryptionKeyId: profile.encryptionKeyId,
    targetDatabaseUrl:
      'postgresql://isolated:different-private-password@127.0.0.1/vcli_restore_fixture',
    targetDatabaseResourceId: 'db:restore',
    protectedDatabaseNames: ['production', 'source_fixture'],
    localRoots: [{ id: 'media', path: join(parent, 'restored-media') }],
    maximumBytes: profile.maximumBytes,
    maximumFiles: profile.maximumFiles,
    availableSecretSourceRefs: profile.policy.secretSourceRefs,
    availableHistoricalMailKeyIds: profile.policy.historicalMailKeyIds,
    externalSnapshotAccessRefs: [],
  };
  return { parent, source, profile, restore };
}
const coverage = (profile: BackupProfile) => ({
  localRoots: profile.localRoots,
  externalResources: profile.externalSnapshots.map((item) => item.resourceId),
  secretSourceRefs: profile.policy.secretSourceRefs,
});
function controlledNative(events: string[]): NativeBackupOperations {
  return {
    describe: fakeDescribe,
    assertReady: async () => {
      events.push('ready');
    },
    dump: async (_url, file) => {
      events.push('dump');
      await writeFile(file, 'controlled-native-dump-private-rows');
    },
    reserveEmptyTarget: async () => {
      events.push('reserve-empty-target');
      return async () => {
        events.push('close-target');
      };
    },
    restore: async (_url, file) => {
      events.push('restore');
      assert.equal(
        await readFile(file, 'utf8'),
        'controlled-native-dump-private-rows',
      );
    },
  };
}

test(
  'controlled native runner: encrypted database + exact private bytes round trip; explicitly unverified runtime/provider outcome',
  { timeout: 30000 },
  async () => {
    const load = await releaseFixture('postgres'),
      { BackupService } = await load<Backup>('backup.service');
    const { parent, profile, restore } = await layout(),
      events: string[] = [];
    try {
      const large = randomBytes(196613);
      await writeFile(join(profile.localRoots[0]!.path, 'large.bin'), large, {
        mode: 0o600,
      });
      await writeFile(
        join(profile.localRoots[0]!.path, 'zero.bin'),
        Buffer.alloc(0),
        { mode: 0o600 },
      );
      const service = new BackupService(controlledNative(events));
      const created = await service.create(
        sourceUrl,
        plan,
        profile,
        coverage(profile),
      );
      assert.equal(created.restoreVerified, false);
      assert.deepEqual(events, ['ready', 'dump', 'ready']);
      assert.equal((await stat(profile.archiveDirectory)).mode & 0o777, 0o700);
      for (const file of await readdir(profile.archiveDirectory)) {
        const bytes = await readFile(join(profile.archiveDirectory, file));
        assert.equal(
          (await stat(join(profile.archiveDirectory, file))).mode & 0o777,
          0o600,
        );
        assert.equal(
          bytes.includes(Buffer.from('controlled-native-dump-private-rows')),
          false,
        );
        assert.equal(bytes.includes(Buffer.from('private-password')), false);
      }
      assert.deepEqual(await readdir(profile.workDirectory), []);
      const restored = await service.restore(restore);
      assert.equal(restored.status, 'restored-unverified');
      assert.equal(restored.externalContent, 'reference-contract-only');
      assert.equal(
        (await readFile(join(restore.localRoots[0]!.path, 'large.bin'))).equals(
          large,
        ),
        true,
      );
      assert.equal(
        (await stat(join(restore.localRoots[0]!.path, 'zero.bin'))).size,
        0,
      );
      assert.deepEqual(
        await readFile(
          join(restore.localRoots[0]!.path, 'private', 'object.bin'),
        ),
        Buffer.from([0, 1, 2, 255, 4, 5]),
      );
      assert.equal(
        (await stat(join(restore.localRoots[0]!.path, 'empty'))).isDirectory(),
        true,
      );
      assert.equal(events.at(-1), 'close-target');
      assert.deepEqual(await readdir(profile.workDirectory), []);
      await assert.rejects(service.restore(restore), /DESTINATION_EXISTS/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);

test('controlled archive validation: wrong key/tamper cannot start native restore; historical-key and external coverage required', async () => {
  const load = await releaseFixture('postgres'),
    { BackupService } = await load<Backup>('backup.service');
  const { parent, profile, restore } = await layout(),
    events: string[] = [];
  try {
    const service = new BackupService(controlledNative(events));
    await service.create(sourceUrl, plan, profile, coverage(profile));
    const originalKey = await readFile(profile.encryptionKeyPath);
    await writeFile(profile.encryptionKeyPath, randomBytes(32));
    await assert.rejects(service.restore(restore));
    await writeFile(profile.encryptionKeyPath, originalKey);
    await assert.rejects(
      service.restore({
        ...restore,
        availableHistoricalMailKeyIds: ['mail-current-key'],
      }),
      /INCOMPLETE/,
    );
    await assert.rejects(
      service.restore({ ...restore, targetDatabaseUrl: sourceUrl }),
      /UNSAFE_RESTORE_DATABASE/,
    );
    await assert.rejects(
      service.restore({
        ...restore,
        targetDatabaseUrl: sourceUrl.replace('/source_fixture', '/production'),
        protectedDatabaseNames: [],
      }),
      /UNSAFE_RESTORE_DATABASE/,
    );
    await assert.rejects(
      service.restore({
        ...restore,
        targetEnvironment: 'production',
      } as unknown as RestoreProfile),
      /INVALID_RESTORE_PROFILE/,
    );
    const encrypted = join(profile.archiveDirectory, 'database.enc'),
      bytes = await readFile(encrypted);
    bytes[21] = bytes[21]! ^ 1;
    await writeFile(encrypted, bytes);
    await assert.rejects(service.restore(restore));
    assert.equal(events.includes('reserve-empty-target'), false);
    assert.deepEqual(await readdir(profile.workDirectory), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('private boundaries: traversal, symlink, overlapping roots, insecure key, unsafe profile and absent object snapshot fail', async () => {
  const load = await releaseFixture('postgres'),
    { BackupService } = await load<Backup>('backup.service'),
    { safeAbsolutePath } = await load<PrivateFiles>('private-files'),
    { assertCoverage, parseBackupInventory } =
      await load<Validation>('backup-validation');
  const { parent, profile } = await layout(),
    events: string[] = [];
  try {
    const service = new BackupService(controlledNative(events));
    assert.throws(() => safeAbsolutePath('../escape'), /UNSAFE/);
    assert.throws(() => safeAbsolutePath('/'), /UNSAFE/);
    await symlink(join(parent, 'media'), join(parent, 'media-link'));
    await assert.rejects(
      service.create(
        sourceUrl,
        plan,
        {
          ...profile,
          localRoots: [{ id: 'media', path: join(parent, 'media-link') }],
        },
        {
          ...coverage(profile),
          localRoots: [{ id: 'media', path: join(parent, 'media-link') }],
        },
      ),
      /SYMLINK/,
    );
    assert.throws(
      () =>
        assertCoverage(
          { ...profile, workDirectory: profile.localRoots[0]!.path },
          profile.localRoots,
          [],
          [],
        ),
      /OVERLAPPING/,
    );
    assert.throws(
      () =>
        assertCoverage(profile, profile.localRoots, ['aws:private-bucket'], []),
      /INCOMPLETE/,
    );
    assert.throws(
      () =>
        assertCoverage(
          {
            ...profile,
            externalSnapshots: [
              {
                resourceId: 'aws:private-bucket',
                provider: 'aws',
                snapshotRef: 'snapshot:immutable-v1',
                immutable: true,
                accessPolicyRef: 'acl:isolated-object-read',
                restoreContractRef: 'runbook:isolated-object-copy',
                retentionUntil: '2000-01-01T00:00:00.000Z',
              },
            ],
          },
          profile.localRoots,
          ['aws:private-bucket'],
          [],
        ),
      /RETENTION/,
    );
    await chmod(profile.encryptionKeyPath, 0o644);
    await assert.rejects(
      service.create(
        sourceUrl,
        plan,
        {
          ...profile,
          archiveDirectory: join(parent, 'archives', 'insecure-key'),
        },
        coverage(profile),
      ),
      /PRIVATE_FILE/,
    );
    assert.equal(events.includes('dump'), false);
    assert.throws(
      () =>
        parseBackupInventory({
          schema: 1,
          roots: [
            {
              id: 'media',
              sourcePath: '/',
              entries: [
                {
                  path: '../escape',
                  kind: 'file',
                  size: 1,
                  payload: 'file-1.enc',
                },
              ],
            },
          ],
        }),
      /INVALID/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

for (const database of ['postgres', 'mongodb'] as const)
  test(`native ${database} command protocol with controlled runner: secrets excluded from argv, temporary credentials private and removed`, async () => {
    const load = await releaseFixture(database),
      { NativeBackup } = await load<NativeBackupModule>('native-backup');
    const { parent, profile } = await layout();
    const url =
      database === 'postgres'
        ? 'postgresql://fixture:colon%3Aback%5Cslash@127.0.0.1/source_fixture?sslmode=disable'
        : 'mongodb://fixture:private-password@127.0.0.1/source_fixture?replicaSet=fixture&authSource=admin';
    const target =
      database === 'postgres'
        ? 'postgresql://isolated:restore-secret@127.0.0.1/restore_fixture?sslmode=disable'
        : 'mongodb://isolated:restore-secret@127.0.0.1/restore_fixture?replicaSet=fixture&authSource=admin';
    let calls = 0;
    const credentials: string[] = [];
    const runner: NativeCommandRunner = async (command: NativeCommand) => {
      calls++;
      assert.equal(command.timeoutMs, 300000);
      assert.doesNotMatch(
        JSON.stringify(command.args),
        /private-password|restore-secret|colon|mongodb:\/\//,
      );
      assert.doesNotMatch(
        JSON.stringify(command.env),
        /restore-secret|private-password|colon/,
      );
      const credential =
        database === 'postgres'
          ? command.env.PGPASSFILE
          : command.args[command.args.indexOf('--config') + 1];
      assert.ok(credential);
      credentials.push(credential);
      assert.equal((await stat(credential)).mode & 0o777, 0o600);
      const text = await readFile(credential, 'utf8');
      if (database === 'mongodb') assert.match(text, /^uri: /);
      else if (calls === 1) assert.match(text, /\\:/);
      if (calls === 2) {
        if (database === 'postgres') {
          assert.ok(command.args.includes('--single-transaction'));
          assert.equal(command.args.includes('--create'), false);
          assert.equal(command.args.includes('--clean'), false);
        } else {
          assert.ok(command.args.includes('--nsFrom=source_fixture.*'));
          assert.ok(command.args.includes('--nsTo=restore_fixture.*'));
          assert.equal(
            command.args.some((arg) => arg.startsWith('--db')),
            false,
          );
          assert.ok(text.includes('authSource=admin'));
        }
        throw new Error('controlled native restore failure');
      }
    };
    try {
      const native = new NativeBackup(runner);
      await native.dump(
        url,
        join(parent, 'native-dump'),
        profile.workDirectory,
      );
      await assert.rejects(
        native.restore(
          target,
          join(parent, 'native-dump'),
          'source_fixture',
          profile.workDirectory,
        ),
        /controlled/,
      );
      assert.equal(calls, 2);
      for (const path of credentials)
        await assert.rejects(stat(path), { code: 'ENOENT' });
      assert.deepEqual(
        native.describe(url),
        native.describe(
          url.replace(
            database === 'postgres'
              ? 'colon%3Aback%5Cslash'
              : 'private-password',
            'different-secret',
          ),
        ),
      );
      assert.throws(
        () =>
          native.restore(
            url,
            join(parent, 'native-dump'),
            'source_fixture',
            profile.workDirectory,
          ),
        /UNSAFE/,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

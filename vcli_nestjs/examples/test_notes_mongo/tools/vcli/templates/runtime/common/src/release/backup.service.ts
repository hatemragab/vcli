import { mkdtemp, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  BackupProfile,
  BackupInventory,
  LocalBackupRoot,
  NativeBackupOperations,
  RestoreProfile,
} from './backup-types.js';
import type { ReleaseManifest } from './release-types.js';
import {
  assertCoverage,
  assertRestoreCoverage,
  parseBackupInventory,
  parseBackupProfile,
  parseRestoreProfile,
} from './backup-validation.js';
import {
  assertPrivateDirectory,
  createPrivateDirectory,
  enumeratePrivateRoot,
  readPrivateJson,
  safeAbsolutePath,
  writePrivateFile,
} from './private-files.js';
import { readArchiveKey, sealFile, unsealFile } from './sealed-file.js';
import { releaseDigest } from './release-validation.js';

export class BackupService {
  constructor(private readonly native: NativeBackupOperations) {}
  async create(
    databaseUrl: string,
    manifest: ReleaseManifest,
    input: BackupProfile,
    coverage: {
      localRoots: readonly LocalBackupRoot[];
      externalResources: readonly string[];
      secretSourceRefs: readonly string[];
    },
  ): Promise<{
    id: string;
    releaseId: string;
    localRootIds: readonly string[];
    externalResourceIds: readonly string[];
    restoreVerified: false;
  }> {
    const profile = parseBackupProfile(input);
    assertCoverage(
      profile,
      coverage.localRoots,
      coverage.externalResources,
      coverage.secretSourceRefs,
    );
    const workParent = await assertPrivateDirectory(profile.workDirectory);
    const archive = await createPrivateDirectory(profile.archiveDirectory);
    const key = await readArchiveKey(profile.encryptionKeyPath);
    let work: string | undefined;
    try {
      work = await mkdtemp(join(workParent, 'vcli-backup-'));
      for (const root of profile.localRoots)
        await enumeratePrivateRoot(
          root.path,
          profile.maximumFiles - 1,
          profile.maximumBytes,
        );
      const source = this.native.describe(databaseUrl);
      await this.native.assertReady(databaseUrl, manifest);
      const dump = join(work, 'database.native');
      const inventory: BackupInventory = {
        schema: 1,
        id: profile.id,
        createdAt: new Date().toISOString(),
        release: manifest,
        releaseDigest: releaseDigest(manifest),
        database: {
          ...source,
          resourceId: profile.databaseResourceId,
          payload: 'database.enc',
          size: 0,
        },
        encryptionKeyId: profile.encryptionKeyId,
        quiescenceRef: profile.quiescenceRef,
        policy: profile.policy,
        externalSnapshots: profile.externalSnapshots,
        roots: [],
      };
      await writePrivateFile(dump, Buffer.alloc(0));
      await this.native.dump(databaseUrl, dump, work);
      inventory.database.size = await sealFile(
        dump,
        join(archive, 'database.enc'),
        key,
        profile.id + ':database',
        profile.maximumBytes,
      );
      if (inventory.database.size === 0)
        throw new Error('EMPTY_NATIVE_DATABASE_DUMP');
      let bytes = inventory.database.size,
        files = 1;
      for (const root of profile.localRoots) {
        const sourcePath = await assertPrivateDirectory(root.path),
          entries = await enumeratePrivateRoot(
            sourcePath,
            profile.maximumFiles - files,
            profile.maximumBytes - bytes,
          );
        const snapshot: BackupInventory['roots'][number] = {
          id: root.id,
          sourcePath,
          entries: [],
        };
        for (const entry of entries) {
          if (
            entry.path
              .split('/')
              .some(
                (name) =>
                  /^\.env(?:\.|$)/.test(name) || /\.(pem|key)$/i.test(name),
              )
          )
            throw new Error('SECRET_FILE_IN_MEDIA_ROOT');
          const payload =
            entry.kind === 'file' ? `file-${files}.enc` : undefined;
          if (payload) {
            const size = await sealFile(
              join(sourcePath, entry.path),
              join(archive, payload),
              key,
              profile.id + ':' + root.id + ':' + entry.path,
              profile.maximumBytes - bytes,
            );
            if (size !== entry.size)
              throw new Error('SNAPSHOT_CHANGED_DURING_BACKUP');
            bytes += size;
          }
          snapshot.entries.push({ ...entry, ...(payload ? { payload } : {}) });
          files++;
        }
        inventory.roots.push(snapshot);
      }
      await this.native.assertReady(databaseUrl, manifest);
      const manifestFile = join(work, 'inventory.json');
      await writePrivateFile(manifestFile, JSON.stringify(inventory));
      await sealFile(
        manifestFile,
        join(archive, 'inventory.enc'),
        key,
        profile.id + ':inventory',
        4 * 1024 * 1024,
      );
      // Public identity file has no filenames, source paths, database URL, keys or private env hashes.
      await writePrivateFile(
        join(archive, 'backup.json'),
        JSON.stringify({
          schema: 1,
          id: profile.id,
          encryptionKeyId: profile.encryptionKeyId,
          releaseId: manifest.id,
          releaseDigest: releaseDigest(manifest),
        }),
      );
      return {
        id: profile.id,
        releaseId: manifest.id,
        localRootIds: profile.localRoots.map((root) => root.id),
        externalResourceIds: profile.externalSnapshots.map(
          (item) => item.resourceId,
        ),
        restoreVerified: false,
      };
    } finally {
      key.fill(0);
      if (work) await rm(work, { recursive: true, force: true });
    }
  }
  async restore(input: RestoreProfile): Promise<{
    id: string;
    releaseId: string;
    status: 'restored-unverified';
    externalContent: 'reference-contract-only';
  }> {
    const profile = parseRestoreProfile(input),
      archive = await assertPrivateDirectory(profile.archiveDirectory),
      workParent = await assertPrivateDirectory(profile.workDirectory);
    const key = await readArchiveKey(profile.encryptionKeyPath);
    let work: string | undefined;
    let releaseTarget: (() => Promise<void>) | undefined;
    try {
      work = await mkdtemp(join(workParent, 'vcli-restore-'));
      const identity = await readPrivateJson(join(archive, 'backup.json'));
      if (
        !identity ||
        typeof identity !== 'object' ||
        !('id' in identity) ||
        typeof identity.id !== 'string' ||
        !/^[a-z][a-z0-9.-]{0,95}$/.test(identity.id)
      )
        throw new Error('INVALID_BACKUP_IDENTITY');
      const inventoryFile = join(work, 'inventory.json');
      await unsealFile(
        join(archive, 'inventory.enc'),
        inventoryFile,
        key,
        identity.id + ':inventory',
        4 * 1024 * 1024,
      );
      const inventory = parseBackupInventory(
        await readPrivateJson(inventoryFile),
      );
      if (inventory.id !== identity.id)
        throw new Error('BACKUP_IDENTITY_MISMATCH');
      assertRestoreCoverage(profile, inventory);
      const target = this.native.describe(profile.targetDatabaseUrl);
      if (
        !/^vcli_restore_[a-z0-9_]{1,48}$/.test(target.name) ||
        target.name === inventory.database.name ||
        target.identity === inventory.database.identity ||
        profile.protectedDatabaseNames.includes(target.name)
      )
        throw new Error('UNSAFE_RESTORE_DATABASE');
      let bytes = inventory.database.size,
        files = 1;
      for (const root of inventory.roots)
        for (const entry of root.entries) {
          bytes += entry.kind === 'file' ? entry.size : 0;
          files++;
        }
      if (bytes > profile.maximumBytes || files > profile.maximumFiles)
        throw new Error('RESTORE_LIMIT_EXCEEDED');
      // Validate every destination before creating any private media or modifying the target DB.
      for (const root of profile.localRoots) {
        const path = safeAbsolutePath(root.path);
        try {
          await lstat(path);
          throw new Error('RESTORE_DESTINATION_EXISTS');
        } catch (error) {
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== 'ENOENT'
          )
            throw error;
        }
        await assertPrivateDirectory(join(path, '..'));
      }
      const dump = join(work, 'database.native');
      if (
        (await unsealFile(
          join(archive, inventory.database.payload),
          dump,
          key,
          inventory.id + ':database',
          profile.maximumBytes,
        )) !== inventory.database.size
      )
        throw new Error('INVALID_BACKUP_PAYLOAD');
      // All authenticated bytes are staged before native restore; target roots remain private on failure.
      for (const root of inventory.roots) {
        const targetRoot = await createPrivateDirectory(
          profile.localRoots.find((item) => item.id === root.id)!.path,
        );
        for (const entry of root.entries) {
          const path = join(targetRoot, entry.path);
          if (entry.kind === 'directory') await createPrivateDirectory(path);
          else if (
            (await unsealFile(
              join(archive, entry.payload!),
              path,
              key,
              inventory.id + ':' + root.id + ':' + entry.path,
              profile.maximumBytes,
            )) !== entry.size
          )
            throw new Error('INVALID_BACKUP_PAYLOAD');
        }
      }
      releaseTarget = await this.native.reserveEmptyTarget(
        profile.targetDatabaseUrl,
        inventory.database.name,
        profile.targetDatabaseResourceId,
      );
      await this.native.restore(
        profile.targetDatabaseUrl,
        dump,
        inventory.database.name,
        work,
      );
      await this.native.assertReady(
        profile.targetDatabaseUrl,
        inventory.release,
      );
      return {
        id: inventory.id,
        releaseId: inventory.release.id,
        status: 'restored-unverified',
        externalContent: 'reference-contract-only',
      };
    } finally {
      key.fill(0);
      try {
        if (releaseTarget) await releaseTarget();
      } finally {
        if (work) await rm(work, { recursive: true, force: true });
      }
    }
  }
}

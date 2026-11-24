import { z } from 'zod';
import type {
  BackupProfile,
  RestoreProfile,
  BackupInventory,
  LocalBackupRoot,
} from './backup-types.js';
import { assertDisjoint, safeAbsolutePath } from './private-files.js';
import { releaseDigest } from './release-validation.js';
const ref = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:/_.@-]{0,255}$/);
const id = z.string().regex(/^[a-z][a-z0-9.-]{0,95}$/);
const path = z.string().min(1).max(4096);
const roots = z.array(z.strictObject({ id, path })).max(16);
const maximumBytes = z
  .number()
  .int()
  .positive()
  .max(100 * 1024 * 1024 * 1024);
const maximumFiles = z.number().int().positive().max(100000);
const policy = z.strictObject({
  accessPolicyRef: ref,
  retentionUntil: z.iso.datetime(),
  secretSourceRefs: z.array(ref).max(64),
  historicalMailKeyIds: z.array(ref).max(64),
});
const external = z
  .array(
    z.strictObject({
      resourceId: ref,
      provider: id,
      snapshotRef: ref,
      immutable: z.literal(true),
      accessPolicyRef: ref,
      restoreContractRef: ref,
      retentionUntil: z.iso.datetime(),
    }),
  )
  .max(32);
const backupSchema = z.strictObject({
  schema: z.literal(1),
  id,
  quiesced: z.literal(true),
  quiescenceRef: ref,
  databaseResourceId: ref,
  archiveDirectory: path,
  workDirectory: path,
  encryptionKeyPath: path,
  encryptionKeyId: ref,
  maximumBytes,
  maximumFiles,
  localRoots: roots,
  externalSnapshots: external,
  policy,
});
const restoreSchema = z.strictObject({
  schema: z.literal(1),
  isolated: z.literal(true),
  targetEnvironment: z.literal('isolated'),
  quiesced: z.literal(true),
  quiescenceRef: ref,
  archiveDirectory: path,
  workDirectory: path,
  encryptionKeyPath: path,
  encryptionKeyId: ref,
  targetDatabaseUrl: z.string().min(1).max(8192),
  targetDatabaseResourceId: ref,
  protectedDatabaseNames: z.array(z.string().min(1).max(128)).max(64),
  localRoots: roots,
  maximumBytes,
  maximumFiles,
  availableSecretSourceRefs: z.array(ref).max(64),
  availableHistoricalMailKeyIds: z.array(ref).max(64),
  externalSnapshotAccessRefs: z.array(ref).max(32),
});
export function parseBackupProfile(value: unknown): BackupProfile {
  const result = backupSchema.safeParse(value);
  if (!result.success) throw new Error('INVALID_BACKUP_PROFILE');
  return result.data;
}
export function parseRestoreProfile(value: unknown): RestoreProfile {
  const result = restoreSchema.safeParse(value);
  if (!result.success) throw new Error('INVALID_RESTORE_PROFILE');
  return result.data;
}
export function assertCoverage(
  profile: BackupProfile,
  expectedRoots: readonly LocalBackupRoot[],
  requiredExternal: readonly string[],
  requiredSecrets: readonly string[],
): void {
  const actual = profile.localRoots.map((root) => ({
    id: root.id,
    path: safeAbsolutePath(root.path),
  }));
  if (
    actual.length !== expectedRoots.length ||
    new Set(actual.map((root) => root.id)).size !== actual.length ||
    expectedRoots.some(
      (root) =>
        !actual.some(
          (item) =>
            item.id === root.id && item.path === safeAbsolutePath(root.path),
        ),
    ) ||
    profile.externalSnapshots.length !== requiredExternal.length ||
    new Set(profile.externalSnapshots.map((item) => item.resourceId)).size !==
      requiredExternal.length ||
    requiredExternal.some(
      (resource) =>
        !profile.externalSnapshots.some((item) => item.resourceId === resource),
    ) ||
    requiredSecrets.some(
      (secret) => !profile.policy.secretSourceRefs.includes(secret),
    )
  )
    throw new Error('INCOMPLETE_BACKUP_COVERAGE');
  if (
    Date.parse(profile.policy.retentionUntil) <= Date.now() ||
    profile.externalSnapshots.some(
      (item) =>
        Date.parse(item.retentionUntil) <
        Date.parse(profile.policy.retentionUntil),
    )
  )
    throw new Error('BACKUP_RETENTION_CONTRACT_REQUIRED');
  assertDisjoint([
    safeAbsolutePath(profile.archiveDirectory),
    safeAbsolutePath(profile.workDirectory),
    safeAbsolutePath(profile.encryptionKeyPath),
    ...actual.map((root) => root.path),
  ]);
}
const component = z.strictObject({
  component: id,
  version: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const inventorySchema = z.strictObject({
  schema: z.literal(1),
  id,
  createdAt: z.iso.datetime(),
  release: z.strictObject({
    schema: z.literal(1),
    id,
    components: z.array(component).max(32),
  }),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  database: z.strictObject({
    resourceId: ref,
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z.literal('database.enc'),
    size: maximumBytes,
  }),
  encryptionKeyId: ref,
  quiescenceRef: ref,
  policy,
  externalSnapshots: external,
  roots: z
    .array(
      z.strictObject({
        id,
        sourcePath: path,
        entries: z
          .array(
            z.strictObject({
              path,
              kind: z.enum(['file', 'directory']),
              size: z.number().int().nonnegative(),
              payload: z
                .string()
                .regex(/^file-[0-9]+\.enc$/)
                .optional(),
            }),
          )
          .max(100000),
      }),
    )
    .max(16),
});
export function parseBackupInventory(value: unknown): BackupInventory {
  const result = inventorySchema.safeParse(value);
  if (!result.success) throw new Error('INVALID_BACKUP_INVENTORY');
  const inventory = result.data;
  if (
    releaseDigest(inventory.release) !== inventory.releaseDigest ||
    new Set(inventory.roots.map((root) => root.id)).size !==
      inventory.roots.length
  )
    throw new Error('INVALID_BACKUP_INVENTORY');
  const payloads = new Set<string>();
  for (const root of inventory.roots) {
    const paths = new Set<string>();
    for (const entry of root.entries) {
      if (
        entry.path.startsWith('/') ||
        entry.path.includes('\\') ||
        entry.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        paths.has(entry.path) ||
        Boolean(entry.payload) !== (entry.kind === 'file') ||
        (entry.payload && payloads.has(entry.payload))
      )
        throw new Error('UNSAFE_BACKUP_INVENTORY');
      paths.add(entry.path);
      if (entry.payload) payloads.add(entry.payload);
    }
  }
  return inventory;
}
export function assertRestoreCoverage(
  profile: RestoreProfile,
  inventory: BackupInventory,
): void {
  if (
    profile.encryptionKeyId !== inventory.encryptionKeyId ||
    profile.targetDatabaseResourceId === inventory.database.resourceId ||
    inventory.roots.length !== profile.localRoots.length ||
    new Set(profile.localRoots.map((root) => root.id)).size !==
      profile.localRoots.length ||
    inventory.roots.some(
      (root) => !profile.localRoots.some((item) => item.id === root.id),
    ) ||
    inventory.policy.secretSourceRefs.some(
      (ref) => !profile.availableSecretSourceRefs.includes(ref),
    ) ||
    inventory.policy.historicalMailKeyIds.some(
      (ref) => !profile.availableHistoricalMailKeyIds.includes(ref),
    ) ||
    inventory.externalSnapshots.some(
      (item) =>
        !profile.externalSnapshotAccessRefs.includes(item.accessPolicyRef) ||
        Date.parse(item.retentionUntil) <= Date.now(),
    )
  )
    throw new Error('INCOMPLETE_ISOLATED_RESTORE_CONTRACT');
  assertDisjoint([
    safeAbsolutePath(profile.archiveDirectory),
    safeAbsolutePath(profile.workDirectory),
    safeAbsolutePath(profile.encryptionKeyPath),
    ...profile.localRoots.map((root) => safeAbsolutePath(root.path)),
  ]);
  for (const root of inventory.roots)
    for (const target of profile.localRoots)
      assertDisjoint([
        safeAbsolutePath(root.sourcePath),
        safeAbsolutePath(target.path),
      ]);
}

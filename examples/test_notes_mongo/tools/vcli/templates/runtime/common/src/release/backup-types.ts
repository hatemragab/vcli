import type { ReleaseManifest } from './release-types.js';
export type LocalBackupRoot = Readonly<{ id: string; path: string }>;
/** Content lives in the provider snapshot; this archive contains references, never implied S3 bytes. */
export type ExternalSnapshot = Readonly<{
  resourceId: string;
  provider: string;
  snapshotRef: string;
  immutable: true;
  accessPolicyRef: string;
  restoreContractRef: string;
  retentionUntil: string;
}>;
export type BackupPolicy = Readonly<{
  accessPolicyRef: string;
  retentionUntil: string;
  secretSourceRefs: readonly string[];
  historicalMailKeyIds: readonly string[];
}>;
export type BackupProfile = Readonly<{
  schema: 1;
  id: string;
  quiesced: true;
  quiescenceRef: string;
  databaseResourceId: string;
  archiveDirectory: string;
  workDirectory: string;
  encryptionKeyPath: string;
  encryptionKeyId: string;
  maximumBytes: number;
  maximumFiles: number;
  localRoots: readonly LocalBackupRoot[];
  externalSnapshots: readonly ExternalSnapshot[];
  policy: BackupPolicy;
}>;
export type RestoreProfile = Readonly<{
  schema: 1;
  isolated: true;
  targetEnvironment: 'isolated';
  quiesced: true;
  quiescenceRef: string;
  archiveDirectory: string;
  workDirectory: string;
  encryptionKeyPath: string;
  encryptionKeyId: string;
  targetDatabaseUrl: string;
  targetDatabaseResourceId: string;
  protectedDatabaseNames: readonly string[];
  localRoots: readonly LocalBackupRoot[];
  maximumBytes: number;
  maximumFiles: number;
  availableSecretSourceRefs: readonly string[];
  availableHistoricalMailKeyIds: readonly string[];
  externalSnapshotAccessRefs: readonly string[];
}>;
export type BackupInventory = {
  schema: 1;
  id: string;
  createdAt: string;
  release: ReleaseManifest;
  releaseDigest: string;
  database: {
    resourceId: string;
    name: string;
    identity: string;
    payload: string;
    size: number;
  };
  encryptionKeyId: string;
  quiescenceRef: string;
  policy: BackupPolicy;
  externalSnapshots: readonly ExternalSnapshot[];
  roots: {
    id: string;
    sourcePath: string;
    entries: {
      path: string;
      kind: 'file' | 'directory';
      size: number;
      payload?: string;
    }[];
  }[];
};
/** Selected native implementation only; injectable runners are controlled tests, not restore proof. */
export interface NativeBackupOperations {
  describe(url: string): { name: string; identity: string };
  assertReady(url: string, manifest: ReleaseManifest): Promise<void>;
  dump(url: string, file: string, privateWork: string): Promise<void>;
  reserveEmptyTarget(
    url: string,
    sourceName: string,
    resourceId: string,
  ): Promise<() => Promise<void>>;
  restore(
    url: string,
    file: string,
    sourceName: string,
    privateWork: string,
  ): Promise<void>;
}

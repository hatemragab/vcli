export type StorageProfile =
  | Readonly<{
      version: 1;
      driver: 'local';
      root: string;
    }>
  | Readonly<{
      version: 1;
      driver: 's3';
      profile: 'aws' | 'r2';
      bucket: string;
      region: string;
      endpoint?: string;
      forcePathStyle: boolean;
    }>;
export type UploadEvidence = Readonly<{
  bytes: number;
  sha256: string;
  md5: string;
}>;
/** Immutable facts supplied by the media owner; storage does not depend on its entity. */
export type StorageObject = Readonly<{
  id: string;
  bytes: number;
  sha256: string;
  stagingRoot: string;
  profile: StorageProfile;
  evidence?: UploadEvidence;
}>;
export const STORAGE_LIMITS = Object.freeze({ processTransfers: 4 });

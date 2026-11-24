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
export type UploadMode = 'mediated' | 'presigned' | 'multipart';
export type UploadEvidence = Readonly<{
  bytes: number;
  sha256: string;
  md5: string;
}>;
export type ObjectEvidence = Readonly<{
  bytes: number;
  sha256: string;
  etag?: string;
  versionId?: string;
}>;
export type MultipartPart = Readonly<{
  partNumber: number;
  bytes: number;
  sha256: string;
  status: 'declared' | 'pending' | 'complete';
  etag?: string;
  checksum?: string;
}>;
export type MultipartState = Readonly<{
  uploadId?: string;
  initiated: boolean;
  partBytes: number;
  parts: readonly MultipartPart[];
}>;
/** Immutable owner facts; storage never imports a media entity or identity model. */
export type StorageObject = Readonly<{
  id: string;
  attemptId?: string;
  generation?: number;
  mode?: UploadMode;
  bytes: number;
  sha256: string;
  expiresAt?: number;
  stagingRoot: string;
  profile: StorageProfile;
  evidence?: UploadEvidence;
  objectEvidence?: ObjectEvidence;
  multipart?: MultipartState;
}>;
export type DirectGrant = Readonly<{
  kind: 's3-post';
  method: 'POST';
  url: string;
  fields: Readonly<Record<string, string>>;
  bytes: number;
  expiresAt: number;
}>;
export const storageId = (
  record: Pick<StorageObject, 'id' | 'attemptId'>,
): string => record.attemptId ?? record.id;
export const readyKey = (
  record: Pick<StorageObject, 'id' | 'attemptId'>,
): string =>
  record.attemptId
    ? `media/${record.id}/${record.attemptId}`
    : `media/${record.id}`;
export const stagingKey = (
  record: Pick<StorageObject, 'id' | 'attemptId'>,
): string => `staging/${record.id}/${storageId(record)}`;
export const STORAGE_LIMITS = Object.freeze({
  processTransfers: 4,
  transferMs: 30000,
  providerMs: 20000,
  maximumBytes: 104857600,
  partBytes: 8388608,
  maxParts: 13,
  grantSeconds: 900,
});

import type {
  StorageProfile,
  UploadEvidence,
} from '../storage/storage.entity.js';

export type MediaStatus =
  | 'reserved'
  | 'receiving'
  | 'uploaded'
  | 'finalizing'
  | 'ready'
  | 'deleting'
  | 'failed';
export type MediaRecord = Readonly<{
  id: string;
  ownerId: string;
  filename: string;
  bytes: number;
  sha256: string;
  createdAt: number;
  expiresAt: number;
  state: MediaStatus;
  stagingRoot: string;
  profile: StorageProfile;
  evidence?: UploadEvidence;
}>;

export type MediaOwnerState = Readonly<{
  revision: number;
  entries: readonly MediaRecord[];
}>;
export const emptyMediaState = (): MediaOwnerState => ({
  revision: 0,
  entries: [],
});
export const MEDIA_LIMITS = Object.freeze({
  maxEntries: 128,
  maxActive: 4,
  quotaBytes: 268435456,
  transferMs: 30000,
});

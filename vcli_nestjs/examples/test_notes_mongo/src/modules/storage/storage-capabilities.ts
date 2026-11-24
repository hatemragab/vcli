import { ApplicationError } from '../../core/errors/application-error.js';
import type { UploadMode } from './storage.entity.js';
export const STORAGE_CAPABILITIES = Object.freeze({
  // BEGIN local
  local: {
    modes: ['mediated'],
    receive: 'bounded-server-stream',
    finalize: 'exclusive-hard-link',
    download: 'mediated-attachment',
    delete: 'exact-attempt',
    multipart: false,
    direct: false,
  },
  // END local
} as const);
type ProfileKind = Readonly<{
  driver: 'local' | 's3';
  profile?: 'aws' | 'r2';
  endpoint?: string;
  region?: string;
}>;
type StorageCapability = Readonly<{
  modes: readonly UploadMode[];
  receive: string;
  finalize: string;
  download: string;
  delete: string;
  multipart: string | false;
  direct: string | false;
}>;
export function storageProfileName(profile: ProfileKind): string {
  return profile.driver === 'local' ? 'local' : (profile.profile ?? '');
}
export function storageCapabilities(profile: ProfileKind): StorageCapability {
  const name = storageProfileName(profile);
  const descriptors: Readonly<Record<string, StorageCapability>> =
    STORAGE_CAPABILITIES;
  const descriptor = descriptors[name];
  if (!descriptor) throw new ApplicationError('INVALID_STORAGE_PROFILE', 422);
  if (name === 'aws' && profile.endpoint)
    throw new ApplicationError('UNSUPPORTED_STORAGE_ENDPOINT', 422);
  if (
    name === 'r2' &&
    (!profile.endpoint ||
      !/^https:\/\/[a-zA-Z0-9-]+\.r2\.cloudflarestorage\.com\/?$/.test(
        profile.endpoint,
      ) ||
      profile.region !== 'auto')
  )
    throw new ApplicationError('UNSUPPORTED_STORAGE_ENDPOINT', 422);
  return descriptor;
}
export function requireUploadMode(
  profile: ProfileKind,
  mode: UploadMode,
): void {
  if (!storageCapabilities(profile).modes.includes(mode))
    throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
}
export const requireStorageMode = requireUploadMode;

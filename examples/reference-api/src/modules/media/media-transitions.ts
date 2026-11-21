import { ApplicationError } from '../../core/errors/application-error.js';
import {
  MEDIA_LIMITS,
  type MediaOwnerState,
  type MediaRecord,
  type MediaStatus,
} from './media.entity.js';
import type { UploadEvidence } from '../storage/storage.entity.js';
export function requireMedia(
  state: MediaOwnerState,
  ownerId: string,
  id: string,
): MediaRecord {
  const record = state.entries.find(
    (entry) => entry.id === id && entry.ownerId === ownerId,
  );
  if (!record) throw new ApplicationError('MEDIA_NOT_FOUND', 404);
  return record;
}
export function reserveMedia(
  state: MediaOwnerState,
  record: MediaRecord,
): MediaOwnerState {
  if (state.entries.some((entry) => entry.id === record.id))
    throw new ApplicationError('MEDIA_CONFLICT', 409);
  if (
    state.entries.length >= MEDIA_LIMITS.maxEntries ||
    state.entries.filter((entry) => entry.state !== 'ready').length >=
      MEDIA_LIMITS.maxActive ||
    state.entries.reduce((sum, entry) => sum + entry.bytes, record.bytes) >
      MEDIA_LIMITS.quotaBytes
  )
    throw new ApplicationError('MEDIA_QUOTA_EXCEEDED', 409);
  return { revision: state.revision + 1, entries: [...state.entries, record] };
}
export function transitionMedia(
  state: MediaOwnerState,
  ownerId: string,
  id: string,
  expected: readonly MediaStatus[],
  next: MediaStatus,
  now: number,
  evidence?: UploadEvidence,
): MediaOwnerState {
  const record = requireMedia(state, ownerId, id);
  if (!expected.includes(record.state))
    throw new ApplicationError('MEDIA_STATE_CONFLICT', 409);
  if (next === 'receiving' && record.expiresAt <= now)
    throw new ApplicationError('UPLOAD_EXPIRED', 410);
  if (
    next === 'uploaded' &&
    (!evidence ||
      evidence.bytes !== record.bytes ||
      evidence.sha256 !== record.sha256)
  )
    throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
  const changed = { ...record, state: next, ...(evidence ? { evidence } : {}) };
  return {
    revision: state.revision + 1,
    entries: state.entries.map((entry) => (entry.id === id ? changed : entry)),
  };
}

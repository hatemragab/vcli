import { ApplicationError } from '../../core/errors/application-error.js';
import {
  MEDIA_LIMITS,
  type MediaOwnerState,
  type MediaRecord,
} from './media.entity.js';
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
  if (
    state.entries.some(
      (entry) =>
        entry.id === record.id ||
        (record.attemptId && entry.attemptId === record.attemptId),
    )
  )
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
export function replaceMedia(
  state: MediaOwnerState,
  before: MediaRecord,
  after: MediaRecord,
): MediaOwnerState {
  if (
    before.id !== after.id ||
    before.ownerId !== after.ownerId ||
    before.attemptId !== after.attemptId ||
    before.generation !== after.generation ||
    before.bytes !== after.bytes ||
    before.sha256 !== after.sha256 ||
    JSON.stringify(before.profile) !== JSON.stringify(after.profile)
  )
    throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
  return {
    revision: state.revision + 1,
    entries: state.entries.map((entry) =>
      entry.id === before.id ? after : entry,
    ),
  };
}

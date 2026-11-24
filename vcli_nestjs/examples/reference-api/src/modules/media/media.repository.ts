import { Injectable } from '@nestjs/common';
import type { UploadEvidence } from '../storage/storage.entity.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { MediaRecord, MediaStatus } from './media.entity.js';
import {
  requireMedia,
  reserveMedia,
  transitionMedia,
} from './media-transitions.js';
import type { MediaStateStore } from './media-state-store.js';
@Injectable()
export class MediaRepository {
  constructor(private readonly store: MediaStateStore) {}
  async reserve(record: MediaRecord): Promise<MediaRecord> {
    const state = await this.store.change(record.ownerId, (state) =>
      reserveMedia(state, record),
    );
    return requireMedia(state, record.ownerId, record.id);
  }
  async list(ownerId: string): Promise<readonly MediaRecord[]> {
    return (await this.store.read(ownerId)).entries;
  }
  async get(ownerId: string, id: string): Promise<MediaRecord> {
    return requireMedia(await this.store.read(ownerId), ownerId, id);
  }
  async transition(
    ownerId: string,
    id: string,
    expected: readonly MediaStatus[],
    next: MediaStatus,
    now: number,
    evidence?: UploadEvidence,
  ): Promise<MediaRecord> {
    const state = await this.store.change(ownerId, (state) =>
      transitionMedia(state, ownerId, id, expected, next, now, evidence),
    );
    return requireMedia(state, ownerId, id);
  }
  async forget(ownerId: string, id: string): Promise<void> {
    await this.store.change(ownerId, (state) => {
      const entry = requireMedia(state, ownerId, id);
      if (entry.state !== 'deleting')
        throw new ApplicationError('MEDIA_STATE_CONFLICT', 409);
      return {
        revision: state.revision + 1,
        entries: state.entries.filter((record) => record.id !== id),
      };
    });
  }
}

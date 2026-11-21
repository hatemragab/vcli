import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { MediaRecord } from './media.entity.js';
import {
  requireMedia,
  reserveMedia,
  replaceMedia,
} from './media-transitions.js';
import type { MediaStateStore } from './media-state-store.js';
@Injectable()
export class MediaRepository {
  constructor(private readonly store: MediaStateStore) {}
  async reserve(record: MediaRecord): Promise<MediaRecord> {
    return requireMedia(
      await this.store.change(record.ownerId, (state) =>
        reserveMedia(state, record),
      ),
      record.ownerId,
      record.id,
    );
  }
  async list(ownerId: string): Promise<readonly MediaRecord[]> {
    return (await this.store.read(ownerId)).entries;
  }
  async get(ownerId: string, id: string): Promise<MediaRecord> {
    return requireMedia(await this.store.read(ownerId), ownerId, id);
  }
  async change(
    ownerId: string,
    id: string,
    update: (record: MediaRecord) => MediaRecord,
  ): Promise<MediaRecord> {
    const state = await this.store.change(ownerId, (state) => {
      const current = requireMedia(state, ownerId, id);
      return replaceMedia(state, current, update(current));
    });
    return requireMedia(state, ownerId, id);
  }
  async forget(record: MediaRecord): Promise<void> {
    await this.store.change(record.ownerId, (state) => {
      const current = requireMedia(state, record.ownerId, record.id);
      if (
        current.state !== 'deleting' ||
        current.attemptId !== record.attemptId ||
        current.generation !== record.generation ||
        current.claim?.token !== record.claim?.token
      )
        throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
      return {
        revision: state.revision + 1,
        entries: state.entries.filter((entry) => entry.id !== record.id),
      };
    });
  }
}

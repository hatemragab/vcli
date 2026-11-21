import type { MediaStateStore } from '../../dist/modules/media/media-state-store.js';
import {
  emptyMediaState,
  type MediaOwnerState,
} from '../../dist/modules/media/media.entity.js';
export class MemoryMediaStateStore implements MediaStateStore {
  private readonly owners = new Map<string, MediaOwnerState>();
  async read(ownerId: string): Promise<MediaOwnerState> {
    return structuredClone(this.owners.get(ownerId) ?? emptyMediaState());
  }
  async change(
    ownerId: string,
    update: (state: MediaOwnerState) => MediaOwnerState,
  ): Promise<MediaOwnerState> {
    const next = update(
      structuredClone(this.owners.get(ownerId) ?? emptyMediaState()),
    );
    this.owners.set(ownerId, structuredClone(next));
    return structuredClone(next);
  }
  async close(): Promise<void> {
    this.owners.clear();
  }
}

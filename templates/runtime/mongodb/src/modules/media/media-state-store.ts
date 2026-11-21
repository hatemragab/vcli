import type { MediaOwnerState } from './media.entity.js';
/** Private persistence mechanism; only the media ledger exposes business operations. */
export interface MediaStateStore {
  read(ownerId: string): Promise<MediaOwnerState>;
  change(
    ownerId: string,
    update: (state: MediaOwnerState) => MediaOwnerState,
  ): Promise<MediaOwnerState>;
  close(): Promise<void>;
}

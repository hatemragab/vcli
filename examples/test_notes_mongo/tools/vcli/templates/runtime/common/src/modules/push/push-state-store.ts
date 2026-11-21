import type { PushState } from './push.entity.js';
export interface PushStateStore {
  read(): Promise<PushState>;
  change(update: (state: PushState) => PushState): Promise<PushState>;
  close(): Promise<void>;
}

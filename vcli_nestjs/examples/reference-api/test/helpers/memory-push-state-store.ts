import {
  emptyPushState,
  type PushState,
} from '../../dist/modules/push/push.entity.js';
import type { PushStateStore } from '../../dist/modules/push/push-state-store.js';
export class MemoryPushStateStore implements PushStateStore {
  private state = emptyPushState();
  async read(): Promise<PushState> {
    return structuredClone(this.state);
  }
  async change(update: (state: PushState) => PushState): Promise<PushState> {
    this.state = structuredClone(update(structuredClone(this.state)));
    return this.read();
  }
  async close(): Promise<void> {
    this.state = emptyPushState();
  }
}

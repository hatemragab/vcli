import { randomUUID } from 'node:crypto';
import type {
  QuiescedReleaseDecision,
  ReleaseLedger,
  ReleaseSession,
  ReleaseStore,
} from '../templates/runtime/common/src/release/release-types.js';
/** Controlled ledger fake only; native locking is proved by the separately opted-in native suite. */
export class ControlledReleaseStore implements ReleaseStore {
  ledger: ReleaseLedger = {
    schema: 1,
    fence: 0,
    holder: null,
    currentRelease: null,
    manifests: [],
    attempts: [],
    decisions: [],
  };
  loseCompletion: 'before' | 'after' | null = null;
  async acquire(recovery?: QuiescedReleaseDecision): Promise<ReleaseSession> {
    if (recovery) {
      if (
        recovery.expectedFence !== this.ledger.fence ||
        recovery.expectedHolder !== this.ledger.holder
      )
        throw new Error('STALE_RELEASE_RECOVERY');
    } else if (this.ledger.holder) throw new Error('RELEASE_BUSY');
    this.ledger.fence++;
    this.ledger.holder = randomUUID();
    return { token: this.ledger.holder, fence: this.ledger.fence };
  }
  async read(): Promise<ReleaseLedger> {
    return structuredClone(this.ledger);
  }
  async change(
    session: ReleaseSession,
    update: (ledger: ReleaseLedger) => void,
  ): Promise<void> {
    if (
      session.token !== this.ledger.holder ||
      session.fence !== this.ledger.fence
    )
      throw new Error('RELEASE_FENCE_LOST');
    const next = structuredClone(this.ledger);
    update(next);
    const completed = next.attempts.some(
      (item) =>
        item.status === 'completed' &&
        this.ledger.attempts.find((old) => old.id === item.id)?.status ===
          'incomplete',
    );
    const fail = completed ? this.loseCompletion : null;
    if (completed) this.loseCompletion = null;
    if (fail === 'before') throw new Error('CONTROLLED_ACK_LOSS');
    this.ledger = next;
    if (fail === 'after') throw new Error('CONTROLLED_ACK_LOSS');
  }
  release(session: ReleaseSession): Promise<void> {
    return this.change(session, (state) => {
      state.holder = null;
    });
  }
  async close(): Promise<void> {}
}

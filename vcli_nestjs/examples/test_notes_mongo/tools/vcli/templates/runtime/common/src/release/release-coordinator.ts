import { randomUUID } from 'node:crypto';
import type {
  ReleaseManifest,
  ReleaseOwner,
  ReleaseStore,
  QuiescedReleaseDecision,
} from './release-types.js';
import {
  assertHistoryCapacity,
  assertQuiescedDecision,
  assertReleaseManifest,
  attemptCompleted,
  releaseDigest,
} from './release-validation.js';

/** Finite release orchestration above owners; no cross-owner rollback or exactly-once claim. */
export class ReleaseCoordinator {
  constructor(private readonly store: ReleaseStore) {}

  async apply(
    manifest: ReleaseManifest,
    owners: readonly ReleaseOwner[],
  ): Promise<readonly string[]> {
    assertReleaseManifest(manifest);
    if (
      owners.length !== manifest.components.length ||
      owners.some(
        (owner, index) =>
          owner.component !== manifest.components[index]?.component,
      )
    )
      throw new Error('RELEASE_OWNER_SET_MISMATCH');
    const session = await this.store.acquire();
    try {
      await this.store.change(session, (ledger) => {
        const hash = releaseDigest(manifest);
        const existing = ledger.manifests.find(
          (item) => item.id === manifest.id,
        );
        if (existing && existing.digest !== hash)
          throw new Error('RELEASE_IDENTITY_MISMATCH');
        if (existing?.completed && ledger.currentRelease?.id !== manifest.id)
          throw new Error('STALE_RELEASE_MANIFEST');
        if (
          ledger.attempts.some(
            (item) => !attemptCompleted(item) && !item.resolution,
          )
        )
          throw new Error('RELEASE_RECONCILIATION_REQUIRED');
        for (const component of manifest.components) {
          if (
            ledger.attempts.some(
              (item) =>
                item.component === component.component &&
                item.version === component.version &&
                item.digest !== component.digest,
            )
          )
            throw new Error('RELEASE_COMPONENT_DIGEST_MISMATCH');
          if (
            ledger.attempts.some(
              (item) =>
                item.component === component.component &&
                attemptCompleted(item) &&
                item.version > component.version,
            )
          )
            throw new Error('STALE_RELEASE_MANIFEST');
        }
        if (!existing) {
          assertHistoryCapacity(ledger);
          ledger.manifests.push({
            id: manifest.id,
            digest: hash,
            completed: false,
          });
        }
      });
      for (const [index, owner] of owners.entries()) {
        const component = manifest.components[index]!;
        const ledger = await this.store.read();
        if (
          ledger?.attempts.some(
            (item) =>
              item.component === component.component &&
              item.version === component.version &&
              item.digest === component.digest &&
              attemptCompleted(item),
          )
        )
          continue;
        const id = randomUUID();
        await this.store.change(session, (state) => {
          assertHistoryCapacity(state);
          state.attempts.push({
            ...component,
            id,
            releaseId: manifest.id,
            fence: session.fence,
            status: 'incomplete',
            startedAt: new Date().toISOString(),
          });
        });
        try {
          // Never place this callback inside a retryable database transaction.
          await owner.apply();
          await this.store.change(session, (state) => {
            const attempt = state.attempts.find((item) => item.id === id);
            if (!attempt || attempt.status !== 'incomplete')
              throw new Error('RELEASE_FENCE_LOST');
            attempt.status = 'completed';
            attempt.completedAt = new Date().toISOString();
          });
        } catch {
          // A thrown callback or lost completion acknowledgement may have committed native work.
          await this.store
            .change(session, (state) => {
              const attempt = state.attempts.find((item) => item.id === id);
              if (attempt?.status === 'incomplete') attempt.status = 'unknown';
            })
            .catch(() => undefined);
          throw new Error('RELEASE_OWNER_OUTCOME_UNKNOWN');
        }
      }
      await this.store.change(session, (state) => {
        const record = state.manifests.find((item) => item.id === manifest.id);
        if (!record) throw new Error('RELEASE_IDENTITY_MISMATCH');
        record.completed = true;
        state.currentRelease = { id: record.id, digest: record.digest };
      });
      return manifest.components.map((item) => item.component);
    } finally {
      await this.store.release(session);
    }
  }

  /** Only after all previous runners/writers are actually stopped and the owner state inspected. */
  async reconcile(
    manifest: ReleaseManifest,
    decision: QuiescedReleaseDecision,
  ): Promise<void> {
    assertReleaseManifest(manifest);
    assertQuiescedDecision(decision);
    const session = await this.store.acquire(decision);
    try {
      await this.store.change(session, (ledger) => {
        if (
          !ledger.manifests.some(
            (item) =>
              item.id === manifest.id &&
              item.digest === releaseDigest(manifest),
          )
        )
          throw new Error('RELEASE_IDENTITY_MISMATCH');
        assertHistoryCapacity(ledger);
        for (const attempt of ledger.attempts)
          if (attempt.status === 'incomplete') attempt.status = 'unknown';
        if (decision.attemptId) {
          const attempt = ledger.attempts.find(
            (item) =>
              item.id === decision.attemptId && item.releaseId === manifest.id,
          );
          if (!attempt || attemptCompleted(attempt) || attempt.resolution)
            throw new Error('RELEASE_ATTEMPT_NOT_RECONCILABLE');
          attempt.resolution = {
            decision: decision.decision!,
            evidence: decision.evidence,
          };
        }
        ledger.decisions.push({
          fence: session.fence,
          evidence: decision.evidence,
          at: new Date().toISOString(),
        });
      });
    } finally {
      await this.store.release(session);
    }
  }
}

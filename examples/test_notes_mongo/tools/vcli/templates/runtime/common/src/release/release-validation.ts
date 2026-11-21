import { createHash } from 'node:crypto';
import type {
  ReleaseLedger,
  ReleaseManifest,
  QuiescedReleaseDecision,
  ReleaseAttempt,
} from './release-types.js';

const name = /^[a-z][a-z0-9.-]{0,95}$/;
const digest = /^[a-f0-9]{64}$/;
export function assertReleaseManifest(manifest: ReleaseManifest): void {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    manifest.schema !== 1 ||
    typeof manifest.id !== 'string' ||
    !Array.isArray(manifest.components) ||
    !name.test(manifest.id) ||
    manifest.components.length > 32 ||
    new Set(manifest.components.map((item) => item.component)).size !==
      manifest.components.length ||
    manifest.components.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.component !== 'string' ||
        typeof item.digest !== 'string' ||
        !name.test(item.component) ||
        !Number.isSafeInteger(item.version) ||
        item.version < 1 ||
        !digest.test(item.digest),
    )
  )
    throw new Error('INVALID_RELEASE_MANIFEST');
}
export function releaseDigest(manifest: ReleaseManifest): string {
  assertReleaseManifest(manifest);
  return createHash('sha256')
    .update(
      JSON.stringify({
        schema: 1,
        id: manifest.id,
        components: manifest.components.map(
          ({ component, version, digest }) => ({ component, version, digest }),
        ),
      }),
    )
    .digest('hex');
}
export function emptyReleaseLedger(): ReleaseLedger {
  return {
    schema: 1,
    fence: 0,
    holder: null,
    currentRelease: null,
    manifests: [],
    attempts: [],
    decisions: [],
  };
}
export function decodeReleaseLedger(value: unknown): ReleaseLedger {
  if (!value || typeof value !== 'object')
    throw new Error('INVALID_RELEASE_HISTORY');
  const v = value as ReleaseLedger;
  if (
    v.schema !== 1 ||
    !Number.isSafeInteger(v.fence) ||
    v.fence < 0 ||
    (v.holder !== null &&
      (typeof v.holder !== 'string' || !/^[a-f0-9-]{36}$/.test(v.holder))) ||
    !Array.isArray(v.manifests) ||
    !Array.isArray(v.attempts) ||
    !Array.isArray(v.decisions) ||
    v.manifests.length > 256 ||
    v.attempts.length > 2048 ||
    v.decisions.length > 256
  )
    throw new Error('INVALID_RELEASE_HISTORY');
  for (const item of v.manifests)
    if (
      !item ||
      !name.test(item.id) ||
      !digest.test(item.digest) ||
      typeof item.completed !== 'boolean'
    )
      throw new Error('INVALID_RELEASE_HISTORY');
  if (
    v.currentRelease !== null &&
    (!v.currentRelease ||
      !v.manifests.some(
        (item) =>
          item.completed &&
          item.id === v.currentRelease?.id &&
          item.digest === v.currentRelease.digest,
      ))
  )
    throw new Error('INVALID_RELEASE_HISTORY');
  for (const item of v.attempts) {
    assertReleaseManifest({
      schema: 1,
      id: item.releaseId,
      components: [item],
    });
    if (
      !item.id ||
      !Number.isSafeInteger(item.fence) ||
      !['incomplete', 'unknown', 'completed'].includes(item.status) ||
      typeof item.startedAt !== 'string' ||
      (item.resolution &&
        (!['completed', 'retry'].includes(item.resolution.decision) ||
          typeof item.resolution.evidence !== 'string'))
    )
      throw new Error('INVALID_RELEASE_HISTORY');
  }
  return structuredClone(v);
}
export function assertHistoryCapacity(ledger: ReleaseLedger): void {
  if (
    ledger.manifests.length >= 256 ||
    ledger.attempts.length >= 2048 ||
    ledger.decisions.length >= 256
  )
    throw new Error('RELEASE_HISTORY_CAPACITY');
}
export function assertQuiescedDecision(value: QuiescedReleaseDecision): void {
  // Evidence is an operator-owned nonsecret ticket/reference, never free-form logs or keys.
  if (
    !value ||
    typeof value !== 'object' ||
    value.quiesced !== true ||
    !Number.isSafeInteger(value.expectedFence) ||
    value.expectedFence < 0 ||
    (value.expectedHolder !== null &&
      (typeof value.expectedHolder !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(value.expectedHolder))) ||
    typeof value.evidence !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:/_.-]{0,159}$/.test(value.evidence) ||
    Boolean(value.attemptId) !== Boolean(value.decision) ||
    (value.attemptId !== undefined &&
      (typeof value.attemptId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(value.attemptId))) ||
    (value.decision && !['completed', 'retry'].includes(value.decision))
  )
    throw new Error('INVALID_QUIESCED_RELEASE_DECISION');
}
export const attemptCompleted = (attempt: ReleaseAttempt): boolean =>
  attempt.status === 'completed' ||
  attempt.resolution?.decision === 'completed';
export function assertLedgerReady(
  ledger: ReleaseLedger | null,
  manifest: ReleaseManifest,
): void {
  const hash = releaseDigest(manifest);
  if (
    !ledger ||
    ledger.holder !== null ||
    ledger.currentRelease?.id !== manifest.id ||
    ledger.currentRelease.digest !== hash ||
    !ledger.manifests.some(
      (item) =>
        item.id === manifest.id && item.digest === hash && item.completed,
    ) ||
    ledger.attempts.some(
      (item) => !attemptCompleted(item) && !item.resolution,
    ) ||
    manifest.components.some(
      (component) =>
        !ledger.attempts.some(
          (item) =>
            item.component === component.component &&
            item.version === component.version &&
            item.digest === component.digest &&
            attemptCompleted(item),
        ) ||
        ledger.attempts.some(
          (item) =>
            item.component === component.component &&
            attemptCompleted(item) &&
            item.version > component.version,
        ),
    )
  )
    throw new Error('SELECTED_RELEASE_NOT_READY');
}

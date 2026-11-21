import { join } from 'node:path';
import { decisionSchema } from './input-schemas.js';
import {
  boundProfile,
  findCreated,
  journalSchema,
  loadJournal,
  nativeDriver,
  newJournal,
  operatorPaths,
  safeError,
  safeUnlock,
} from './operator-journal.js';
import { assertMutationResult } from './postconditions.js';
import {
  acquireLock,
  ensureJournalDirectory,
  readOptional,
  releaseLock,
  writePrivateJson,
} from './private-files.js';
import { probeReadiness } from './readiness-probe.js';
import { summarizeDeployment, type DeploymentSummary } from './summary.js';
import type {
  DeploymentJournal,
  DeploymentPlan,
  DeploymentSnapshot,
  OperatorOptions,
  ReconciliationDecision,
  TargetProfile,
} from './types.js';
import { fail, identifier, record, validateProfile } from './validation.js';

export async function discoverDeployment(
  profile: TargetProfile,
  options: OperatorOptions = {},
): Promise<DeploymentSnapshot> {
  try {
    return await nativeDriver(profile, options).discover();
  } catch (error) {
    throw safeError(error);
  }
}

/** Apply never treats timeout as failure or blindly retries an incomplete request. */
export async function applyDeployment(
  plan: DeploymentPlan,
  input: TargetProfile,
  options: OperatorOptions = {},
): Promise<DeploymentSummary> {
  let journal: DeploymentJournal | undefined;
  let lockId: string | undefined;
  let path: ReturnType<typeof operatorPaths> | undefined;
  try {
    const p = boundProfile(plan, input);
    path = operatorPaths(plan, p);
    await ensureJournalDirectory(p.journalDirectory);
    lockId = await acquireLock(path.lock, plan.id);
    const driver = nativeDriver(p, options);
    journal = (await loadJournal(path.journal, plan)) ?? newJournal(plan);
    journal.verified = false;
    const binding = await readOptional(path.binding);
    if (binding !== undefined && record(binding).planId !== plan.id) {
      const previousId = record(binding).planId;
      if (typeof previousId !== 'string' || !/^[a-f0-9]{64}$/.test(previousId))
        fail('INVALID_DEPLOYMENT_BINDING');
      const previous = journalSchema.safeParse(
        await readOptional(join(p.journalDirectory, previousId + '.json')),
      );
      if (!previous.success || previous.data.verified !== true)
        fail('PREVIOUS_OPERATION_RECONCILIATION_REQUIRED');
      if (!plan.snapshot.resources.length) fail('EXPECTED_RESOURCE_MISSING');
    }
    await writePrivateJson(path.binding, {
      planId: plan.id,
      operationId: plan.release.operationId,
    });
    // Persist intent even if the process is interrupted before the first native request.
    await writePrivateJson(path.journal, journal);
    for (const step of journal.steps) {
      if (step.state === 'completed') continue;
      if (step.state === 'incomplete' || step.state === 'unknown') {
        step.state = 'unknown';
        await writePrivateJson(path.journal, journal);
        if (step.name === 'create') {
          const current = await driver.discover();
          const id = findCreated(plan, current);
          if (id) {
            journal.resourceId = id;
            step.state = 'completed';
            journal.checkpoint = current;
            await writePrivateJson(path.journal, journal);
            continue;
          }
        }
        fail('UNKNOWN_OPERATION_RECONCILIATION_REQUIRED');
      }
      const before = await driver.discover();
      if (before.fingerprint !== journal.checkpoint.fingerprint)
        fail('STALE_REMOTE_SETTINGS');
      step.state = 'incomplete';
      await writePrivateJson(path.journal, journal);
      try {
        await driver.mutate(step.name, plan, journal.resourceId);
        const after = await driver.discover();
        if (step.name === 'create') {
          const id = findCreated(plan, after);
          if (!id) fail('UNKNOWN_OPERATION_RECONCILIATION_REQUIRED');
          journal.resourceId = id;
        } else if (
          after.resources.length !== 1 ||
          after.resources[0]?.id !== journal.resourceId
        )
          fail('DEPLOYMENT_SCOPE_MISMATCH');
        assertMutationResult(step.name, plan, before, after);
        journal.checkpoint = after;
        step.state = 'completed';
        await writePrivateJson(path.journal, journal);
      } catch (error) {
        step.state = 'unknown';
        journal.verified = false;
        await writePrivateJson(path.journal, journal);
        // Recovery is discovery only: no second POST and no credential/volume replacement.
        if (step.name === 'create') {
          try {
            const current = await driver.discover();
            const id = findCreated(plan, current);
            if (id) {
              journal.resourceId = id;
              journal.checkpoint = current;
              step.state = 'completed';
              await writePrivateJson(path.journal, journal);
              continue;
            }
          } catch {
            /* Preserve unknown and the original fixed failure. */
          }
        }
        throw error;
      }
    }
    return summarizeDeployment(journal);
  } catch (error) {
    throw safeError(error, journal);
  } finally {
    if (lockId && path) await safeUnlock(path.lock, lockId, journal);
  }
}

export async function inspectDeployment(
  plan: DeploymentPlan,
  input: TargetProfile,
  options: OperatorOptions = {},
): Promise<{
  summary?: DeploymentSummary;
  snapshot: DeploymentSnapshot;
  lockId?: string;
}> {
  try {
    const p = boundProfile(plan, input);
    const path = operatorPaths(plan, p);
    const journal = await loadJournal(path.journal, plan);
    const lock = await readOptional(path.lock);
    const lockId = lock === undefined ? undefined : identifier(record(lock).id);
    return {
      summary: journal ? summarizeDeployment(journal) : undefined,
      snapshot: await nativeDriver(p, options).discover(),
      ...(lockId ? { lockId } : {}),
    };
  } catch (error) {
    throw safeError(error);
  }
}

export async function reconcileDeployment(
  plan: DeploymentPlan,
  input: TargetProfile,
  decision: ReconciliationDecision,
  options: OperatorOptions = {},
): Promise<DeploymentSummary> {
  let journal: DeploymentJournal | undefined;
  let lockId: string | undefined;
  let path: ReturnType<typeof operatorPaths> | undefined;
  try {
    const parsed = decisionSchema.safeParse(decision);
    if (!parsed.success || decision.expectedPlanId !== plan.id)
      fail('INVALID_RECONCILIATION_DECISION');
    const p = boundProfile(plan, input);
    path = operatorPaths(plan, p);
    await ensureJournalDirectory(p.journalDirectory);
    const oldLock = await readOptional(path.lock);
    if (oldLock !== undefined) {
      if (
        !decision.expectedLockId ||
        record(oldLock).id !== decision.expectedLockId ||
        record(oldLock).planId !== plan.id
      )
        fail('DEPLOYMENT_LOCK_ID_MISMATCH');
      await releaseLock(path.lock, decision.expectedLockId);
    } else if (decision.expectedLockId) fail('DEPLOYMENT_LOCK_ID_MISMATCH');
    lockId = await acquireLock(path.lock, plan.id);
    journal = await loadJournal(path.journal, plan);
    if (!journal && oldLock !== undefined) {
      journal = newJournal(plan);
      journal.steps[0]!.state = 'unknown';
    }
    if (!journal) fail('DEPLOYMENT_JOURNAL_REQUIRED');
    const step = journal.steps.find((s) => s.state !== 'completed');
    if (
      !step ||
      step.name !== decision.expectedStep ||
      !(
        ['unknown', 'incomplete'].includes(step.state) ||
        (step.state === 'pending' && decision.decision === 'retry')
      ) ||
      journal.decisions.length >= 256
    )
      fail('INVALID_RECONCILIATION_DECISION');
    const driver = nativeDriver(p, options);
    const current = await driver.discover();
    if (current.fingerprint !== decision.expectedFingerprint)
      fail('STALE_RECONCILIATION_DECISION');
    if (step.name === 'create') {
      const id = findCreated(plan, current);
      if (decision.decision === 'retry' && id)
        fail('EXISTING_RESOURCE_REQUIRES_COMPLETION');
      if (decision.decision === 'completed') {
        if (!id) fail('EXPECTED_RESOURCE_MISSING');
        journal.resourceId = id;
      }
    } else if (
      current.resources.length !== 1 ||
      current.resources[0]?.id !== journal.resourceId
    )
      fail('DEPLOYMENT_SCOPE_MISMATCH');
    if (
      decision.decision === 'completed' &&
      step.name !== 'create' &&
      step.name !== 'deploy'
    )
      assertMutationResult(step.name, plan, journal.checkpoint, current);
    if (step.name === 'deploy' && decision.decision === 'completed') {
      await driver.verify(plan, journal.resourceId!);
      await probeReadiness(plan, options);
    }
    step.state = decision.decision === 'completed' ? 'completed' : 'pending';
    journal.checkpoint = current;
    journal.verified = false;
    journal.decisions.push({
      step: step.name,
      decision: decision.decision,
      evidenceRef: decision.evidenceRef,
    });
    await writePrivateJson(path.journal, journal);
    return summarizeDeployment(journal);
  } catch (error) {
    throw safeError(error, journal);
  } finally {
    if (lockId && path) await safeUnlock(path.lock, lockId, journal);
  }
}

export async function verifyDeployment(
  plan: DeploymentPlan,
  input: TargetProfile,
  options: OperatorOptions = {},
): Promise<DeploymentSummary> {
  let journal: DeploymentJournal | undefined;
  let lockId: string | undefined;
  let path: ReturnType<typeof operatorPaths> | undefined;
  try {
    const p = boundProfile(plan, input);
    path = operatorPaths(plan, p);
    lockId = await acquireLock(path.lock, plan.id);
    journal = await loadJournal(path.journal, plan);
    if (
      !journal?.resourceId ||
      journal.steps.some((s) => s.state !== 'completed')
    )
      fail('DEPLOYMENT_APPLY_INCOMPLETE');
    const driver = nativeDriver(p, options);
    const current = await driver.discover();
    if (current.fingerprint !== journal.checkpoint.fingerprint)
      fail('STALE_REMOTE_SETTINGS');
    journal.verified = false;
    await writePrivateJson(path.journal, journal);
    await driver.verify(plan, journal.resourceId);
    await probeReadiness(plan, options);
    journal.verified = true;
    await writePrivateJson(path.journal, journal);
    return summarizeDeployment(journal);
  } catch (error) {
    throw safeError(error, journal);
  } finally {
    if (lockId && path) await safeUnlock(path.lock, lockId, journal);
  }
}

/** Root integration facade: all mutations retain plan binding, private journal and preconditions. */
export function createDeploymentOperator(
  profile: TargetProfile,
  options: OperatorOptions = {},
) {
  const p = validateProfile(profile);
  return {
    discover: () => discoverDeployment(p, options),
    readSnapshot: () => discoverDeployment(p, options),
    apply: (plan: DeploymentPlan) => applyDeployment(plan, p, options),
    inspect: (plan: DeploymentPlan) => inspectDeployment(plan, p, options),
    reconcile: (plan: DeploymentPlan, decision: ReconciliationDecision) =>
      reconcileDeployment(plan, p, decision, options),
    verify: (plan: DeploymentPlan) => verifyDeployment(plan, p, options),
  };
}

/** Pure validation for root CLI previews; performs no discovery, file access or writes. */
export function assertDeploymentProfile(
  plan: DeploymentPlan,
  profile: TargetProfile,
): void {
  boundProfile(plan, profile);
}

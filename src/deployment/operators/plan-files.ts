import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseDeploymentPlan } from './plan.js';
import {
  parseDeploymentSnapshot,
  parseReconciliationDecision,
  parseReleaseFacts,
} from './input-schemas.js';
import { readPrivateJson, validatePrivateAncestors } from './private-files.js';
import type {
  DeploymentPlan,
  DeploymentSnapshot,
  ReconciliationDecision,
  ReleaseFacts,
} from './types.js';
import { fail } from './validation.js';

export async function loadDeploymentPlan(
  path: string,
): Promise<DeploymentPlan> {
  return parseDeploymentPlan(await readPrivateJson(path));
}
export async function loadReleaseFacts(path: string): Promise<ReleaseFacts> {
  return parseReleaseFacts(await readPrivateJson(path));
}
export async function loadDeploymentSnapshot(
  path: string,
): Promise<DeploymentSnapshot> {
  return parseDeploymentSnapshot(await readPrivateJson(path));
}
export async function loadReconciliationDecision(
  path: string,
): Promise<ReconciliationDecision> {
  return parseReconciliationDecision(await readPrivateJson(path));
}
async function saveExclusive(path: string, value: unknown): Promise<void> {
  const data = Buffer.from(JSON.stringify(value) + '\n');
  if (data.length > 1024 * 1024) fail('PUBLIC_PLAN_FILE_LIMIT');
  let created = false;
  try {
    await validatePrivateAncestors(dirname(path));
    const handle = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const parent = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } catch {
    if (created) await unlink(path).catch(() => undefined);
    fail('PUBLIC_PLAN_FILE_NOT_SAVED');
  }
}
/** Explicit save only; never overwrites an existing plan, file, hardlink or symlink. */
export async function saveDeploymentPlan(
  path: string,
  plan: DeploymentPlan,
): Promise<void> {
  await saveExclusive(path, parseDeploymentPlan(plan));
}
export async function saveDeploymentSnapshot(
  path: string,
  snapshot: DeploymentSnapshot,
): Promise<void> {
  await saveExclusive(path, parseDeploymentSnapshot(snapshot));
}

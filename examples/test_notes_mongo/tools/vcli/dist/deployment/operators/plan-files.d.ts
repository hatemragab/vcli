import type { DeploymentPlan, DeploymentSnapshot, ReconciliationDecision, ReleaseFacts } from './types.js';
export declare function loadDeploymentPlan(path: string): Promise<DeploymentPlan>;
export declare function loadReleaseFacts(path: string): Promise<ReleaseFacts>;
export declare function loadDeploymentSnapshot(path: string): Promise<DeploymentSnapshot>;
export declare function loadReconciliationDecision(path: string): Promise<ReconciliationDecision>;
/** Explicit save only; never overwrites an existing plan, file, hardlink or symlink. */
export declare function saveDeploymentPlan(path: string, plan: DeploymentPlan): Promise<void>;
export declare function saveDeploymentSnapshot(path: string, snapshot: DeploymentSnapshot): Promise<void>;

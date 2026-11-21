import { type DeploymentSummary } from './summary.js';
import type { DeploymentPlan, DeploymentSnapshot, OperatorOptions, ReconciliationDecision, TargetProfile } from './types.js';
export declare function discoverDeployment(profile: TargetProfile, options?: OperatorOptions): Promise<DeploymentSnapshot>;
/** Apply never treats timeout as failure or blindly retries an incomplete request. */
export declare function applyDeployment(plan: DeploymentPlan, input: TargetProfile, options?: OperatorOptions): Promise<DeploymentSummary>;
export declare function inspectDeployment(plan: DeploymentPlan, input: TargetProfile, options?: OperatorOptions): Promise<{
    summary?: DeploymentSummary;
    snapshot: DeploymentSnapshot;
    lockId?: string;
}>;
export declare function reconcileDeployment(plan: DeploymentPlan, input: TargetProfile, decision: ReconciliationDecision, options?: OperatorOptions): Promise<DeploymentSummary>;
export declare function verifyDeployment(plan: DeploymentPlan, input: TargetProfile, options?: OperatorOptions): Promise<DeploymentSummary>;
/** Root integration facade: all mutations retain plan binding, private journal and preconditions. */
export declare function createDeploymentOperator(profile: TargetProfile, options?: OperatorOptions): {
    discover: () => Promise<DeploymentSnapshot>;
    readSnapshot: () => Promise<DeploymentSnapshot>;
    apply: (plan: DeploymentPlan) => Promise<DeploymentSummary>;
    inspect: (plan: DeploymentPlan) => Promise<{
        summary?: DeploymentSummary;
        snapshot: DeploymentSnapshot;
        lockId?: string;
    }>;
    reconcile: (plan: DeploymentPlan, decision: ReconciliationDecision) => Promise<DeploymentSummary>;
    verify: (plan: DeploymentPlan) => Promise<DeploymentSummary>;
};
/** Pure validation for root CLI previews; performs no discovery, file access or writes. */
export declare function assertDeploymentProfile(plan: DeploymentPlan, profile: TargetProfile): void;

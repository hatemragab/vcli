import type { DeploymentPlan, DeploymentSnapshot, DeploymentStep } from './types.js';
/** Native acknowledgement alone is insufficient; compare the managed nonsecret result. */
export declare function assertMutationResult(step: DeploymentStep, plan: DeploymentPlan, before: DeploymentSnapshot, after: DeploymentSnapshot): void;

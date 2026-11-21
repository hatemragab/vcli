import type { ServicePlan } from '../../recipes/service-plan-types.js';
import type { DeploymentPlan, DeploymentSnapshot, ReleaseFacts } from './types.js';
/** Pure operator planning. This function performs no I/O and does not accept a credential profile. */
export declare function planDeployment(services: ServicePlan, snapshot: DeploymentSnapshot, input: ReleaseFacts): DeploymentPlan;
export declare function assertPlan(plan: DeploymentPlan): void;
/** Bounded structural parsing and full semantic re-planning of saved public input. */
export declare function parseDeploymentPlan(value: unknown): DeploymentPlan;

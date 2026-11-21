import type { DeploymentPlan, OperatorOptions } from './types.js';
/** Separate public unauthenticated HTTPS client. No native token/header is reachable here. */
export declare function probeReadiness(plan: DeploymentPlan, options: OperatorOptions): Promise<void>;

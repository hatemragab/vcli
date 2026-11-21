import type { DeploymentPlan } from './types.js';
export declare function imageCompose(plan: DeploymentPlan): Record<string, unknown>;
/** Only validated technical settings are hashed; runtime environment contents are excluded. */
export declare function composeFingerprint(value: unknown): string | null;
/** Stable native volume references only; never accepts a private host path or environment value. */
export declare function composeVolumeBindings(value: unknown): {
    resourceRef: string;
    containerPath: string;
}[];

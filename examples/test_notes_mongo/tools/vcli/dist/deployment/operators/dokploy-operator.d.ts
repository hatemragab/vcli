import type { DeploymentPlan, DeploymentSnapshot, DeploymentStep, NativeDriver, OperatorOptions, TargetProfile } from './types.js';
/** Dokploy 0.31.3 raw, standard Compose with an immutable prebuilt API image. Never Stack. */
export declare class DokployOperator implements NativeDriver {
    private readonly profile;
    private readonly http;
    constructor(profile: TargetProfile, options?: OperatorOptions);
    discover(): Promise<DeploymentSnapshot>;
    private one;
    mutate(step: DeploymentStep, plan: DeploymentPlan, resourceId?: string): Promise<void>;
    private domainMatches;
    verify(plan: DeploymentPlan, id: string): Promise<void>;
}

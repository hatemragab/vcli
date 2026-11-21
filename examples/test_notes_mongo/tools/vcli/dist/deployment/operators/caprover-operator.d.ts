import type { DeploymentPlan, DeploymentSnapshot, DeploymentStep, NativeDriver, OperatorOptions, TargetProfile } from './types.js';
/** CapRover 1.16.0 native app settings, schema2 image deploy; dependencies remain preprovisioned. */
export declare class CaproverOperator implements NativeDriver {
    private readonly profile;
    private readonly http;
    constructor(profile: TargetProfile, options?: OperatorOptions);
    private apps;
    private one;
    private checkHooks;
    private limits;
    discover(): Promise<DeploymentSnapshot>;
    mutate(step: DeploymentStep, plan: DeploymentPlan, id?: string): Promise<void>;
    verify(plan: DeploymentPlan, id: string): Promise<void>;
}

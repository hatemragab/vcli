import type { DeploymentPlan, DeploymentSnapshot, DeploymentStep, NativeDriver, OperatorOptions, TargetProfile } from './types.js';
/** Coolify 4.7.5 Git Compose, fixed source commit, root base directory, existing standalone destination. */
export declare class CoolifyOperator implements NativeDriver {
    private readonly profile;
    private readonly http;
    constructor(profile: TargetProfile, options?: OperatorOptions);
    private appPath;
    private envKeys;
    discover(): Promise<DeploymentSnapshot>;
    private assertNoHooks;
    private domains;
    private configuration;
    mutate(step: DeploymentStep, plan: DeploymentPlan, id?: string): Promise<void>;
    verify(plan: DeploymentPlan, id: string): Promise<void>;
}

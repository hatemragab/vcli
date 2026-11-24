import type { ServicePlan } from '../recipes/service-plan-types.js';
import type { ServiceRunner } from './service-types.js';
export interface DevOptions {
    root: string;
    plan: ServicePlan;
    port: number;
    environment: NodeJS.ProcessEnv;
    envFile?: string;
    dryRun?: boolean;
}
export declare function planDevCommand(options: DevOptions): {
    command: string;
    args: readonly string[];
    environment: string;
    port: number;
};
/** Owner-only regular file. Dry-run callers must not invoke this. */
export declare function assertOwnerEnvFile(envFile: string): Promise<void>;
/** Probe only the requested local listener, never scan or kill another process. */
export declare function assertDevPortAvailable(port: number): Promise<void>;
/** One explicit Nest invocation; lock release never removes a replaced user file. */
export declare function executeDevCommand(options: DevOptions, runner?: ServiceRunner): Promise<{
    status: 'planned' | 'completed';
    plan: ReturnType<typeof planDevCommand>;
    code?: number;
}>;

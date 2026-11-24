import type { ServicePlan } from '../recipes/service-plan-types.js';
export interface ServiceInvocation {
    command: string;
    args: readonly string[];
    cwd: string;
    /** Values are private execution input, never included in plans or results. */
    environment: NodeJS.ProcessEnv;
}
export type ServiceAction = 'up' | 'down' | 'status';
export interface ServiceExecutionOptions {
    root: string;
    plan: ServicePlan;
    environment: NodeJS.ProcessEnv;
    databasePort?: number;
    cgroupParent?: string;
    dryRun?: boolean;
}
export interface ServiceCommandPlan {
    schemaVersion: 1;
    action: ServiceAction;
    project: string;
    environment: string;
    composeProject: string;
    command: string;
    args: readonly string[];
    setupArgs?: readonly string[];
    readinessArgs?: readonly string[];
    noServices: boolean;
    preservesVolumes: true;
}
export interface CommandResult {
    code: number;
    stdout: string;
    signal?: NodeJS.Signals;
}
export interface ServiceExecutionResult {
    plan: ServiceCommandPlan;
    status: 'planned' | 'no-services' | 'completed';
    services?: readonly {
        service: string;
        state: string;
    }[];
}
export type ServiceRunner = (invocation: ServiceInvocation) => Promise<CommandResult>;

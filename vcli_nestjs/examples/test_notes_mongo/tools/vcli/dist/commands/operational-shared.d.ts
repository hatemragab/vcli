import type { ProjectConfig } from '../contracts.js';
import { readProject } from '../engine/state.js';
import type { ServicePlan } from '../recipes/service-plan-types.js';
import type { ProjectOutcomes } from '../engine/types.js';
import type { ServiceRunner, CommandResult as ProcessResult } from '../services/service-types.js';
import { type CommandResult } from './command-output.js';
export interface OperationalCommandContext {
    project(): string;
    emit(result: CommandResult): void;
    setOperation(name: string): void;
    json(): boolean;
}
/** Explicit controlled execution seams; ordinary registration needs only program/context. */
export interface OperationalExecution {
    environment?: () => NodeJS.ProcessEnv;
    serviceRunner?: ServiceRunner;
    devRunner?: ServiceRunner;
    releaseRunner?: ServiceRunner;
}
export declare function localEnvironment(input: string): 'development' | 'test';
export declare function localPort(input: string): number;
export declare function selectedProject(root: string): Promise<{
    config: ProjectConfig;
    outcomes: ProjectOutcomes;
    lock: Awaited<ReturnType<typeof readProject>>['lock'];
}>;
export declare function localPlan(config: ProjectConfig, environment: 'development' | 'test'): ServicePlan;
export declare function requireLocalProfile(lock: Awaited<ReturnType<typeof readProject>>['lock'], environment: string): void;
export declare function requireInstalled(outcomes: ProjectOutcomes): void;
export declare function emitExit(context: OperationalCommandContext, operation: string, data: Record<string, unknown>, result: ProcessResult, error?: unknown): void;
export declare function assertPrivateInput(file: string): Promise<void>;

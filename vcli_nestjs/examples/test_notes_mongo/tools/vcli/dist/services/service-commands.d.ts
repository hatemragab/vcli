import type { ServiceAction, ServiceCommandPlan, ServiceExecutionOptions, ServiceRunner, ServiceExecutionResult } from './service-types.js';
/** Dry planning deliberately does not inspect files, environment, ports or processes. */
export declare function planServiceCommand(action: ServiceAction, options: ServiceExecutionOptions): ServiceCommandPlan;
/** Every discovered container must belong to this exact project directory and selected service. */
export declare function assertServiceOwnership(stdout: string, options: ServiceExecutionOptions, composeProject: string): void;
/** Read-only ownership preflight, then a bounded native Compose invocation; no installs or resets. */
export declare function executeServiceCommand(action: ServiceAction, options: ServiceExecutionOptions, runner?: ServiceRunner): Promise<ServiceExecutionResult>;

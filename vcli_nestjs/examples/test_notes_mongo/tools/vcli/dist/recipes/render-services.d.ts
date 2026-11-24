import type { ProjectConfig, RenderedFile } from '../contracts.js';
import type { EnvironmentContribution } from './render-config.js';
import type { ServicePlan, ServicePlanOptions } from './service-plan-types.js';
/** Only selected local dependencies. The API remains an ordinary project-local Nest process. */
export declare function localCompose(plan: ServicePlan): Record<string, unknown>;
export declare function serviceFiles(config: ProjectConfig, fields: readonly EnvironmentContribution[], options?: ServicePlanOptions): RenderedFile[];

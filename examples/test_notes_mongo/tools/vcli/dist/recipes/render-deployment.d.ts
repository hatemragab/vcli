import type { ProjectConfig, RenderedFile } from '../contracts.js';
import type { EnvironmentContribution } from './render-config.js';
import type { ServicePlan, ServicePlanOptions } from './service-plan-types.js';
/** Runtime references only; optional blanks stay empty/normalized by selected config. */
export declare function serviceEnvironment(plan: ServicePlan): Record<string, string | null>;
/** JSON is valid YAML 1.2 and is checked by Docker Compose's native parser. */
export declare function targetCompose(plan: ServicePlan): Record<string, unknown>;
export declare function deploymentFiles(config: ProjectConfig, fields: readonly EnvironmentContribution[], options?: ServicePlanOptions): RenderedFile[];

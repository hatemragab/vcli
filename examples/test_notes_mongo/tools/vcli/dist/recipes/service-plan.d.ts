import { type ProjectConfig } from '../contracts.js';
import type { EnvironmentContribution } from './render-config.js';
import { serviceImages } from './service-plan-contributions.js';
import type { ServicePlan, ServicePlanOptions } from './service-plan-types.js';
export { serviceImages };
/** Artifact contracts reviewed against official docs, not live platform acceptance. */
export declare const targetContracts: Readonly<{
    local: "compose-v2";
    dokploy: "0.31.3";
    coolify: "4.7.5";
    caprover: "1.16.0";
}>;
/** Retain full project metadata while bounding native resource identifiers to 63 characters. */
export declare function serviceResourceName(project: string, suffix: string): string;
/** Finite selected requirements. Pure: no environment, filesystem, process or network reads. */
export declare function describeServices(config: ProjectConfig, fields: readonly EnvironmentContribution[], options?: ServicePlanOptions): ServicePlan;

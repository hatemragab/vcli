import type { ProjectConfig } from '../contracts.js';
import type { EnvironmentContribution } from './render-config.js';
import type { ResourceId, ServiceEnvironment, ServicePlan, ServicePlanOptions, ServiceRequirement } from './service-plan-types.js';
export declare const serviceImages: Readonly<{
    node: "node:26.13.1-bookworm-slim";
    mongodb: "mongo:8.0.38";
    postgres: "postgres:16.16-bookworm";
}>;
export interface ServicePlanContext {
    config: ProjectConfig;
    target: ServicePlan['target'];
    environment: ServiceEnvironment;
    isProduction: boolean;
    topology: 'single' | 'cluster';
    env: readonly EnvironmentContribution[];
    options: ServicePlanOptions;
    ref: (id: string) => string;
    services: ServiceRequirement[];
    external: ServicePlan['externalRequirements'][number][];
    volumes: ServicePlan['volumes'][number][];
    jobs: ServicePlan['jobs'][number][];
    ingress: ServicePlan['ingress'][number][];
    pending: string[];
}
export declare function addExternalRequirement(ctx: ServicePlanContext, id: ResourceId, keys: string[], requirement: string): void;
export declare function addNodeVolume(ctx: ServicePlanContext, id: string, path: string, purpose: string): void;
export declare function contributeDatabaseService(ctx: ServicePlanContext): void;
export declare function contributeStorageAndDiagnostics(ctx: ServicePlanContext): void;
export declare function contributeProviderExternalsAndJobs(ctx: ServicePlanContext): void;
export declare function contributeRealtimeAndIngress(ctx: ServicePlanContext): void;

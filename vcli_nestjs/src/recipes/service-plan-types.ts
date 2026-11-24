import type { EnvironmentContribution } from './render-config.js';

export type ServiceEnvironment =
  'development' | 'test' | 'staging' | 'production';
export type DeploymentTarget = 'dokploy' | 'coolify' | 'caprover';
export type ResourceId =
  | 'database'
  | 'storage'
  | 'firebase'
  | 'smtp'
  | 'http-mail'
  | 'fcm'
  | 'apns'
  | 'centrifugo'
  | 'redis'
  | 'diagnostic-reader';
export interface ServicePlanOptions {
  environment?: ServiceEnvironment;
  targetVersion?: string;
  topology?: 'single' | 'cluster';
  replicas?: number;
  /** Opaque operator resource IDs, never URLs, credentials or private paths. */
  externalResources?: Partial<Record<ResourceId, string>>;
  requireExternalResources?: boolean;
  /** Host-specific explicit seam; portable output never assumes an Orca host. */
  cgroupParent?: string;
}
export interface ServicePort {
  port: number;
  visibility: 'loopback' | 'private' | 'public-ingress';
  purpose: string;
}
export interface ServiceRequirement {
  id: string;
  kind: 'api' | 'database' | 'realtime' | 'diagnostics' | 'redis';
  execution: 'project' | 'compose' | 'external' | 'native';
  resourceRef: string;
  image?: string;
  command: readonly string[];
  ports: readonly ServicePort[];
  dependsOn: readonly string[];
  environment: readonly EnvironmentContribution[];
  resources: { memoryMiB: number; cpus: number; pids: number };
  health: {
    scope: 'process' | 'readiness' | 'external';
    check: string;
    applicationAcceptance: false;
  };
  volumes: readonly string[];
}
export interface ServicePlan {
  schemaVersion: 1;
  project: string;
  environment: ServiceEnvironment;
  nodeEnvironment: 'development' | 'test' | 'production';
  target: 'local' | DeploymentTarget;
  targetVersion: string;
  topology: 'single' | 'cluster';
  replicas: number;
  cgroupParent?: string;
  services: readonly ServiceRequirement[];
  volumes: readonly {
    id: string;
    resourceRef: string;
    containerPath: string;
    owner: 'node' | 'database';
    mode: '0700';
    purpose: string;
    backup: 'required' | 'reconstructible';
  }[];
  externalRequirements: readonly {
    id: ResourceId;
    resourceRef?: string;
    environmentKeys: readonly string[];
    requirement: string;
  }[];
  jobs: readonly {
    id: 'release' | 'mail-drain' | 'identity-cleanup';
    command: readonly string[];
    scheduler: 'operator';
    concurrency: 'database-lock' | 'bounded-cas-lease';
    restart: 'no';
    dependsOn: readonly string[];
  }[];
  ingress: {
    service: string;
    port: number;
    path: string;
    websocket: boolean;
    stickiness: 'none-single-instance';
    tls: 'operator';
    deniedApiPaths: readonly string[];
  }[];
  operatorReview: readonly string[];
  pending: readonly string[];
}

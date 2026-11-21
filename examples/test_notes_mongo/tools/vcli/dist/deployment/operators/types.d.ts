import type { ServicePlan, DeploymentTarget } from '../../recipes/service-plan-types.js';
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export interface TargetScope {
    namespace: string;
    projectId: string;
    environmentId: string;
    serverId: string;
    appName: string;
    resourceId?: string;
    /** Optional explicit CapRover native Swarm node binding. */
    nodeId?: string;
    destinationId?: string;
}
/** Private execution input only. Never store this in project config, plans or output. */
export interface TargetProfile {
    schemaVersion: 1;
    target: DeploymentTarget;
    origin: string;
    targetVersion: string;
    scope: TargetScope;
    token: string;
    journalDirectory: string;
    environment: Record<string, string>;
    /** Exact existing keys whose replacement the operator deliberately authorizes. */
    replaceEnvironmentKeys: string[];
    exclusive: {
        quiesced: true;
        evidenceRef: string;
        secretRevisionRef: string;
    };
}
export interface ResourceSnapshot {
    id: string;
    name: string;
    operationId: string | null;
    /** Explicit whitelist of technical settings only, never raw native responses. */
    settings: {
        [key: string]: Json;
    };
    environmentKeys: string[];
}
export interface DeploymentSnapshot {
    schemaVersion: 1;
    target: DeploymentTarget;
    targetVersion: string;
    origin: string;
    scope: TargetScope;
    resources: ResourceSnapshot[];
    /** SHA256 of the above NONSECRET projection only. No environment value is hashed. */
    fingerprint: string;
}
export interface ReleaseFacts {
    operationId: string;
    sourceCommit: string;
    /** Required for Dokploy and CapRover: published OCI reference with immutable digest. */
    image?: string;
    /** Required for Coolify Git Compose; credentials in repository URLs are prohibited. */
    source?: {
        repository: string;
        branch: string;
    };
    schemaReleaseId?: string;
    readinessUrl: string;
    managedEnvironmentKeys: string[];
    preconditions: {
        exclusiveRef: string;
        secretRevisionRef: string;
        ingressRef: string;
        /** Resource ID -> reviewed private connectivity/permissions evidence identifier. */
        externalResources: Record<string, string>;
        /** Durable volume resourceRef -> reviewed ownership/backup/node evidence identifier. */
        volumes: Record<string, string>;
        nodeId?: string;
    };
}
export interface DeploymentPlan {
    schemaVersion: 1;
    id: string;
    services: ServicePlan;
    snapshot: DeploymentSnapshot;
    release: ReleaseFacts;
    steps: DeploymentStep[];
}
export type DeploymentStep = 'create' | 'configure' | 'environment' | 'domain' | 'ssl' | 'deploy';
export interface JournalStep {
    name: DeploymentStep;
    state: 'pending' | 'incomplete' | 'unknown' | 'completed';
}
export interface DeploymentJournal {
    schemaVersion: 1;
    planId: string;
    operationId: string;
    resourceId?: string;
    disposition: 'created' | 'reused';
    steps: JournalStep[];
    checkpoint: DeploymentSnapshot;
    verified: boolean;
    decisions: {
        step: DeploymentStep;
        decision: 'completed' | 'retry';
        evidenceRef: string;
    }[];
}
export interface OperatorOptions {
    /** Explicit transport seam for controlled protocol fixtures, never inferred from env. */
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
}
export interface NativeDriver {
    discover(): Promise<DeploymentSnapshot>;
    mutate(step: DeploymentStep, plan: DeploymentPlan, resourceId?: string): Promise<void>;
    verify(plan: DeploymentPlan, resourceId: string): Promise<void>;
}
export interface ReconciliationDecision {
    quiesced: true;
    expectedPlanId: string;
    expectedStep: DeploymentStep;
    expectedFingerprint: string;
    /** An old process must actually be stopped; expiry or timeout is insufficient. */
    expectedLockId?: string;
    decision: 'completed' | 'retry';
    evidenceRef: string;
}

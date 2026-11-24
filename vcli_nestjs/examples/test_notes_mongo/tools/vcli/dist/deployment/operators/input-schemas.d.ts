import { z } from 'zod';
import type { ServicePlan } from '../../recipes/service-plan-types.js';
import type { DeploymentSnapshot, ReconciliationDecision, ReleaseFacts } from './types.js';
export declare function parseServicePlan(value: unknown): ServicePlan;
export declare const releaseSchema: z.ZodObject<{
    operationId: z.ZodUUID;
    sourceCommit: z.ZodString;
    image: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodObject<{
        repository: z.ZodString;
        branch: z.ZodString;
    }, z.core.$strict>>;
    schemaReleaseId: z.ZodOptional<z.ZodString>;
    readinessUrl: z.ZodString;
    managedEnvironmentKeys: z.ZodArray<z.ZodString>;
    preconditions: z.ZodObject<{
        exclusiveRef: z.ZodString;
        secretRevisionRef: z.ZodString;
        ingressRef: z.ZodString;
        externalResources: z.ZodRecord<z.ZodString, z.ZodString>;
        volumes: z.ZodRecord<z.ZodString, z.ZodString>;
        nodeId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare function parseReleaseFacts(value: unknown): ReleaseFacts;
export declare function parseDeploymentSnapshot(value: unknown): DeploymentSnapshot;
export declare const decisionSchema: z.ZodObject<{
    quiesced: z.ZodLiteral<true>;
    expectedPlanId: z.ZodString;
    expectedStep: z.ZodEnum<{
        environment: "environment";
        create: "create";
        configure: "configure";
        domain: "domain";
        ssl: "ssl";
        deploy: "deploy";
    }>;
    expectedFingerprint: z.ZodString;
    expectedLockId: z.ZodOptional<z.ZodUUID>;
    decision: z.ZodEnum<{
        completed: "completed";
        retry: "retry";
    }>;
    evidenceRef: z.ZodString;
}, z.core.$strict>;
export declare function parseReconciliationDecision(value: unknown): ReconciliationDecision;

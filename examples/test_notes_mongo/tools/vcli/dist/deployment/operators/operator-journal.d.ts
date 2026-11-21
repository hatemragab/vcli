import { z } from 'zod';
import { DeploymentOperatorError } from './deployment-operator-error.js';
import type { DeploymentJournal, DeploymentPlan, DeploymentSnapshot, NativeDriver, OperatorOptions, TargetProfile } from './types.js';
export declare function nativeDriver(input: TargetProfile, options?: OperatorOptions): NativeDriver;
export declare function safeError(error: unknown, journal?: DeploymentJournal): DeploymentOperatorError;
export declare function safeUnlock(path: string, id: string, journal?: DeploymentJournal): Promise<void>;
export declare function boundProfile(plan: DeploymentPlan, input: TargetProfile): TargetProfile;
export declare function operatorPaths(plan: DeploymentPlan, p: TargetProfile): {
    journal: string;
    lock: string;
    binding: string;
};
export declare const journalSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    planId: z.ZodString;
    operationId: z.ZodUUID;
    resourceId: z.ZodOptional<z.ZodString>;
    disposition: z.ZodEnum<{
        created: "created";
        reused: "reused";
    }>;
    steps: z.ZodArray<z.ZodObject<{
        name: z.ZodEnum<{
            environment: "environment";
            create: "create";
            configure: "configure";
            domain: "domain";
            ssl: "ssl";
            deploy: "deploy";
        }>;
        state: z.ZodEnum<{
            pending: "pending";
            incomplete: "incomplete";
            unknown: "unknown";
            completed: "completed";
        }>;
    }, z.core.$strict>>;
    checkpoint: z.ZodCustom<DeploymentSnapshot, DeploymentSnapshot>;
    verified: z.ZodBoolean;
    decisions: z.ZodArray<z.ZodObject<{
        step: z.ZodEnum<{
            environment: "environment";
            create: "create";
            configure: "configure";
            domain: "domain";
            ssl: "ssl";
            deploy: "deploy";
        }>;
        decision: z.ZodEnum<{
            completed: "completed";
            retry: "retry";
        }>;
        evidenceRef: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare function loadJournal(path: string, plan: DeploymentPlan): Promise<DeploymentJournal | undefined>;
export declare function newJournal(plan: DeploymentPlan): DeploymentJournal;
export declare function findCreated(plan: DeploymentPlan, current: DeploymentSnapshot): string | undefined;

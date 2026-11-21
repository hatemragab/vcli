import { z } from 'zod';
import type { ProjectConfig } from '../contracts.js';
import type { ProjectLock, OperationJournal } from './types.js';
export declare const recipeVersionSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodString;
    family: z.ZodString;
}, z.core.$strict>;
export declare const lockSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    toolVersion: z.ZodEnum<{
        "0.1.2": "0.1.2";
        "0.1.0": "0.1.0";
        "0.1.1": "0.1.1";
    }>;
    config: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        project: z.ZodObject<{
            name: z.ZodString;
            packageManager: z.ZodLiteral<"npm">;
        }, z.core.$strict>;
        capabilities: z.ZodRecord<z.ZodString, z.ZodObject<{
            recipe: z.ZodString;
            options: z.ZodRecord<z.ZodString, z.ZodType<import("../contracts.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../contracts.js").JsonValue, unknown>>>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    recipes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
        family: z.ZodString;
    }, z.core.$strict>>;
    files: z.ZodRecord<z.ZodString, z.ZodObject<{
        ownership: z.ZodEnum<{
            managed: "managed";
            scaffold: "scaffold";
        }>;
        hash: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodBoolean>;
        provenance: z.ZodOptional<z.ZodObject<{
            renderer: z.ZodString;
            template: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    packageFields: z.ZodRecord<z.ZodString, z.ZodType<import("../contracts.js").JsonValue, unknown, z.core.$ZodTypeInternals<import("../contracts.js").JsonValue, unknown>>>;
    checks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        command: z.ZodLiteral<"npm">;
        args: z.ZodTuple<[z.ZodLiteral<"run">, z.ZodString], null>;
    }, z.core.$strict>>;
    pending: z.ZodArray<z.ZodString>;
    outcomes: z.ZodObject<{
        source: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
        install: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
        checks: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
    }, z.core.$strict>;
    operationId: z.ZodString;
    migrations: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare function validateLock(value: unknown): ProjectLock;
export declare function readProject(projectDir: string): Promise<{
    projectDir: string;
    config: ProjectConfig;
    lock: ProjectLock;
    configBytes: Buffer;
    lockBytes: Buffer;
}>;
export declare const journalSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    projectDir: z.ZodString;
    status: z.ZodEnum<{
        failed: "failed";
        recovered: "recovered";
        conflicted: "conflicted";
        applying: "applying";
        "source-completed": "source-completed";
    }>;
    outcomes: z.ZodObject<{
        source: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
        install: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
        checks: z.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
        }>;
    }, z.core.$strict>;
    entries: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        before: z.ZodNullable<z.ZodString>;
        afterHash: z.ZodString;
        status: z.ZodEnum<{
            pending: "pending";
            written: "written";
            restored: "restored";
        }>;
    }, z.core.$strict>>;
    createdDirectories: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare function validateJournal(input: unknown, projectDir: string): OperationJournal;

import { z } from 'zod';
import { SUPPORTED_TOOL_VERSIONS, TOOL_VERSION, type JsonValue, type ProjectConfig } from '../contracts.js';
export { SUPPORTED_TOOL_VERSIONS, TOOL_VERSION };
export declare const hash: (content: string | Buffer) => string;
export declare const json: (value: unknown) => string;
export declare function canonical(value: unknown): string;
export declare function parseJson(content: string, stage?: string): unknown;
export declare const identifierSchema: z.ZodString;
export declare function validateIdentifier(value: string): void;
export declare const jsonValueSchema: z.ZodType<JsonValue>;
export declare const configSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    project: z.ZodObject<{
        name: z.ZodString;
        packageManager: z.ZodLiteral<"npm">;
    }, z.core.$strict>;
    capabilities: z.ZodRecord<z.ZodString, z.ZodObject<{
        recipe: z.ZodString;
        options: z.ZodRecord<z.ZodString, z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare function rejectPrivateValues(value: unknown): void;
export declare function validateConfig(input: unknown): ProjectConfig;
export declare function validateToolchain(version?: string): void;
export declare const hashSchema: z.ZodString;
export declare const idSchema: z.ZodString;
export declare const outcomeSchema: z.ZodEnum<{
    pending: "pending";
    completed: "completed";
    failed: "failed";
}>;
export declare const outcomesSchema: z.ZodObject<{
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
export declare const checkSchema: z.ZodObject<{
    name: z.ZodString;
    command: z.ZodLiteral<"npm">;
    args: z.ZodTuple<[z.ZodLiteral<"run">, z.ZodString], null>;
}, z.core.$strict>;

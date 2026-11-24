import { z } from 'zod';
import type { DeploymentSnapshot, Json, ResourceSnapshot, TargetProfile } from './types.js';
export declare const versions: {
    readonly dokploy: "0.31.3";
    readonly coolify: "4.7.5";
    readonly caprover: "1.16.0";
};
export declare const idSchema: z.ZodString;
export declare const refSchema: z.ZodString;
export declare const commitSchema: z.ZodString;
export declare const imageSchema: z.ZodString;
export declare const keySchema: z.ZodString;
export declare const scopeSchema: z.ZodObject<{
    namespace: z.ZodString;
    projectId: z.ZodString;
    environmentId: z.ZodString;
    serverId: z.ZodString;
    appName: z.ZodString;
    resourceId: z.ZodOptional<z.ZodString>;
    nodeId: z.ZodOptional<z.ZodString>;
    destinationId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare function fail(code: string): never;
export declare function record(value: unknown): Record<string, unknown>;
export declare function list(value: unknown): unknown[];
export declare function identifier(value: unknown): string;
export declare function same(a: unknown, b: unknown): boolean;
export declare function canonical(value: unknown): string;
export declare function digest(value: unknown): string;
export declare function httpsUrl(value: string, originOnly?: boolean): URL;
export declare function validateProfile(input: unknown): TargetProfile;
export declare function snapshot(profile: TargetProfile, resources: ResourceSnapshot[]): DeploymentSnapshot;
/** Parse only field names; never hash or return private values. Ambiguous dotenv requires manual setup. */
export declare function environmentLines(value: unknown): {
    lines: string[];
    keys: string[];
};
export declare function environmentRows(value: unknown): {
    key: string;
    value: string;
}[];
export declare function assertReplacement(profile: TargetProfile, existing: string[]): void;
export declare function operationMarker(value: unknown): string | null;
export declare function technical(raw: Record<string, unknown>, fields: readonly string[]): {
    [key: string]: Json;
};

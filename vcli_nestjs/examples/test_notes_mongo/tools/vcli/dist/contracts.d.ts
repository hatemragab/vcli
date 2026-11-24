import { z } from 'zod';
/** Shared release metadata and config validation codes across CLI layers. */
export declare const TOOL_VERSION = "0.1.2";
export declare const SUPPORTED_TOOL_VERSIONS: readonly ["0.1.0", "0.1.1", "0.1.2"];
export declare const NODE_ENGINE_RANGE = ">=26.13.1 <27";
export declare const CONFIG_ERROR_CODES: readonly ["INVALID_CONFIG", "INVALID_JWT_POLICY", "INVALID_SMTP_CONFIG", "UNSAFE_PRODUCTION_CAPTURE", "RUNTIME_PROVIDER_SELECTION_UNSUPPORTED", "UNSAFE_ENV_FILE", "ENV_FILE_UNAVAILABLE", "INVALID_FIREBASE_ACTION_POLICY", "INVALID_PUSH_ENVIRONMENT", "INVALID_MAIL_DELIVERY_KEYS", "INVALID_MAIL_DELIVERY_LEASE", "INVALID_CENTRIFUGO_CONFIG"];
/** Project metadata stays unchanged; service resource names are normalized separately. */
export declare const projectNameSchema: z.ZodString;
/** Shared generation contracts. These describe files and recipes, never provider I/O. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
export interface RecipeSelection {
    recipe: string;
    options: JsonObject;
}
export interface ProjectConfig {
    schemaVersion: 1;
    project: {
        name: string;
        packageManager: 'npm';
    };
    capabilities: Record<string, RecipeSelection>;
}
export interface Recipe {
    id: string;
    version: string;
    family: string;
    /** Required capability family names, supplied by explicit selections. */
    requires: readonly string[];
    /** Conflicting recipe IDs. */
    conflicts: readonly string[];
    validateOptions: (options: unknown) => JsonObject;
}
export type FileOwnership = 'managed' | 'scaffold';
export interface RenderedFile {
    path: string;
    content: string;
    ownership: FileOwnership;
    provenance?: FileProvenance;
}
export interface CheckCommand {
    name: string;
    command: string;
    args: string[];
}
export interface RenderedProject {
    files: RenderedFile[];
    checks: CheckCommand[];
    warnings: string[];
    pending: string[];
}
export interface RecipeCatalog {
    recipes: readonly Recipe[];
    render: (config: ProjectConfig, resolved: readonly Recipe[]) => Promise<RenderedProject>;
}
/** Allowlisted failure facts. Never carry a caught exception, source bytes, or secret values. */
export type FailureOrigin = 'validation' | 'distribution';
export interface ScriptDiagnostic {
    path: string;
    line?: number;
    column?: number;
    code: string;
}
export interface FileProvenance {
    renderer: string;
    template?: string;
}
export interface FailureDetails {
    recipe?: string;
    option?: string;
    path?: string;
    hint?: string;
    origin?: FailureOrigin;
    step?: string;
    script?: string;
    exitCode?: number | null;
    signal?: string;
    operationId?: string;
    rerun?: string;
    diagnostics?: readonly ScriptDiagnostic[];
    outcomes?: {
        source: string;
        install: string;
        checks: string;
    };
    releaseId?: string;
    owners?: readonly string[];
    keys?: readonly string[];
}
export declare function publicDetails(details?: FailureDetails): Record<string, unknown>;
export declare class BoundedFailure extends Error {
    readonly code: string;
    readonly stage: string;
    readonly action: string;
    readonly details: FailureDetails;
    constructor(code: string, stage: string, action: string, details?: FailureDetails);
    toJSON(): Record<string, unknown>;
}
export declare function validationFailure(code: string, action: string, details?: FailureDetails): BoundedFailure;
export declare function distributionFailure(code: string, action: string, details?: FailureDetails): BoundedFailure;
/** Map known generator failures. Arbitrary exception text is never copied. */
export declare function describeThrown(error: unknown): BoundedFailure | undefined;

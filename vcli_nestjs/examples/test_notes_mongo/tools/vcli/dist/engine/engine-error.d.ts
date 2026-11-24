import { BoundedFailure, type FailureDetails } from '../contracts.js';
export type EngineErrorCode = 'INVALID_CONFIG' | 'INVALID_OPTIONS' | 'UNSUPPORTED_SCHEMA' | 'UNSUPPORTED_TOOLCHAIN' | 'UNKNOWN_RECIPE' | 'INVALID_CATALOG' | 'MISSING_CAPABILITY' | 'RECIPE_CYCLE' | 'RECIPE_CONFLICT' | 'UNSAFE_PATH' | 'INVALID_IDENTIFIER' | 'NONEMPTY_DESTINATION' | 'STATE_DRIFT' | 'MANAGED_CONFLICT' | 'STALE_PLAN' | 'INVALID_PLAN' | 'PROJECT_BUSY' | 'INCOMPLETE_OPERATION' | 'SOURCE_FAILED' | 'INSTALL_FAILED' | 'INSTALL_INCOMPLETE' | 'CHECK_FAILED' | 'RECOVERY_CONFLICT' | 'INVALID_STATE';
export declare function isEngineCode(code: string): code is EngineErrorCode;
/** Only allowlisted facts belong in public errors. Never attach the caught error or input. */
export declare class EngineError extends Error {
    readonly code: EngineErrorCode;
    readonly stage: string;
    readonly action: string;
    readonly details: FailureDetails;
    constructor(code: EngineErrorCode, stage: string, action: string, details?: FailureDetails);
    toJSON(): Record<string, unknown>;
}
export declare function toEngineError(error: BoundedFailure, operationId?: string): EngineError;
/** Keep the plan or journal id on a failure without replacing a more specific error. */
export declare function correlateFailure(error: unknown, operationId?: string): unknown;

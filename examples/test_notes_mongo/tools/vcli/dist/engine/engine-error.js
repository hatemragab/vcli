import { BoundedFailure, publicDetails, } from '../contracts.js';
const engineCodes = [
    'INVALID_CONFIG',
    'INVALID_OPTIONS',
    'UNSUPPORTED_SCHEMA',
    'UNSUPPORTED_TOOLCHAIN',
    'UNKNOWN_RECIPE',
    'INVALID_CATALOG',
    'MISSING_CAPABILITY',
    'RECIPE_CYCLE',
    'RECIPE_CONFLICT',
    'UNSAFE_PATH',
    'INVALID_IDENTIFIER',
    'NONEMPTY_DESTINATION',
    'STATE_DRIFT',
    'MANAGED_CONFLICT',
    'STALE_PLAN',
    'INVALID_PLAN',
    'PROJECT_BUSY',
    'INCOMPLETE_OPERATION',
    'SOURCE_FAILED',
    'INSTALL_FAILED',
    'INSTALL_INCOMPLETE',
    'CHECK_FAILED',
    'RECOVERY_CONFLICT',
    'INVALID_STATE',
];
export function isEngineCode(code) {
    return engineCodes.includes(code);
}
/** Only allowlisted facts belong in public errors. Never attach the caught error or input. */
export class EngineError extends Error {
    code;
    stage;
    action;
    details;
    constructor(code, stage, action, details = {}) {
        super(`${code}: ${action}`);
        this.name = 'EngineError';
        this.code = code;
        this.stage = stage;
        this.action = action;
        this.details = details;
    }
    toJSON() {
        return {
            code: this.code,
            stage: this.stage,
            action: this.action,
            ...publicDetails(this.details),
        };
    }
}
export function toEngineError(error, operationId) {
    const code = isEngineCode(error.code) ? error.code : 'INVALID_OPTIONS';
    return new EngineError(code, error.stage, error.action, {
        ...error.details,
        ...(operationId
            ? { operationId: error.details.operationId ?? operationId }
            : {}),
        ...(!isEngineCode(error.code) && !error.details.option
            ? { option: error.code }
            : {}),
    });
}
/** Keep the plan or journal id on a failure without replacing a more specific error. */
export function correlateFailure(error, operationId) {
    if (!operationId)
        return error;
    if (error instanceof EngineError)
        return error.details.operationId
            ? error
            : new EngineError(error.code, error.stage, error.action, {
                ...error.details,
                operationId,
            });
    if (error instanceof BoundedFailure)
        return toEngineError(error, operationId);
    return error;
}
//# sourceMappingURL=engine-error.js.map
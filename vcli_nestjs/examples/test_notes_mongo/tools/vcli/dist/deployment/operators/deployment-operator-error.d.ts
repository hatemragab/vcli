import type { DeploymentSummary } from './summary.js';
/** A fixed code plus nonsecret progress; raw provider/file/network failures are never exposed. */
export declare class DeploymentOperatorError extends Error {
    readonly code: string;
    readonly summary?: DeploymentSummary | undefined;
    constructor(code: string, summary?: DeploymentSummary | undefined);
}

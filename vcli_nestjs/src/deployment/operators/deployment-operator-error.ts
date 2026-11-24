import type { DeploymentSummary } from './summary.js';

/** A fixed code plus nonsecret progress; raw provider/file/network failures are never exposed. */
export class DeploymentOperatorError extends Error {
  constructor(
    readonly code: string,
    readonly summary?: DeploymentSummary,
  ) {
    super(code);
    this.name = 'DeploymentOperatorError';
  }
}

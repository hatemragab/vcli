import { ApplicationError } from '../errors/application-error.js';
export function databaseError(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  const code = databaseErrorCode(error);
  if (code === 11000) throw new ApplicationError('IDENTITY_EXISTS', 409);
  if (
    typeof error === 'object' &&
    error !== null &&
    'hasErrorLabel' in error &&
    typeof error.hasErrorLabel === 'function' &&
    error.hasErrorLabel('UnknownTransactionCommitResult')
  )
    throw new ApplicationError('COMMIT_OUTCOME_UNKNOWN', 503);
  throw new ApplicationError('DATABASE_UNAVAILABLE', 503);
}
export function databaseErrorCode(error: unknown): string | number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (typeof error.code === 'string' || typeof error.code === 'number')
  )
    return error.code;
  return undefined;
}

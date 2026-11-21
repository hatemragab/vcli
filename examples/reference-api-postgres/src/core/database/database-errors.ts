import { ApplicationError } from '../errors/application-error.js';
export function databaseError(error: unknown): never {
  if (error instanceof ApplicationError) throw error;
  if (databaseErrorCode(error) === '23505')
    throw new ApplicationError('IDENTITY_EXISTS', 409);
  throw new ApplicationError('DATABASE_UNAVAILABLE', 503);
}

export function databaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return undefined;
}
export function databaseErrorCause(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'cause' in error)
    return error.cause ?? error;
  return error;
}

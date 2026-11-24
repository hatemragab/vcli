import { AuthRuntimeError } from '@vcli/auth-runtime/errors';
import { ApplicationError } from '../errors/application-error.js';
/** Fixed safe mapping; library/provider messages and credential material never cross this boundary. */
export function authRuntimeError(error: unknown): never {
  if (error instanceof AuthRuntimeError) {
    const status =
      error.code === 'HASH_CAPACITY'
        ? 429
        : error.code === 'INVALID_ACCESS_TOKEN'
          ? 401
          : error.code === 'PASSWORD_INPUT_INVALID' ||
              error.code === 'INVALID_OPAQUE_CAPABILITY'
            ? 400
            : 503;
    throw new ApplicationError(error.code, status);
  }
  throw new ApplicationError('AUTH_CRYPTO_UNAVAILABLE', 503);
}

const codes = [
  'PASSWORD_INPUT_INVALID',
  'PASSWORD_POLICY_INVALID',
  'HASH_CAPACITY',
  'CREDENTIAL_STORAGE_INVALID',
  'CRYPTO_FAILURE',
  'JWT_POLICY_INVALID',
  'TOKEN_INPUT_INVALID',
  'INVALID_ACCESS_TOKEN',
  'INVALID_OPAQUE_CAPABILITY',
  'INVALID_CAPABILITY_HASH',
  'INVALID_OPAQUE_PURPOSE',
] as const;

export type AuthRuntimeErrorCode = (typeof codes)[number];

/** Deliberately carries no input, cause, library error, status or application policy. */
export class AuthRuntimeError extends Error {
  readonly code: AuthRuntimeErrorCode;

  constructor(code: AuthRuntimeErrorCode) {
    const safeCode = codes.includes(code) ? code : 'CRYPTO_FAILURE';
    super(safeCode);
    this.name = 'AuthRuntimeError';
    this.code = safeCode;
  }
}

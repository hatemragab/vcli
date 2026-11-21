declare const codes: readonly ["PASSWORD_INPUT_INVALID", "PASSWORD_POLICY_INVALID", "HASH_CAPACITY", "CREDENTIAL_STORAGE_INVALID", "CRYPTO_FAILURE", "JWT_POLICY_INVALID", "TOKEN_INPUT_INVALID", "INVALID_ACCESS_TOKEN", "INVALID_OPAQUE_CAPABILITY", "INVALID_CAPABILITY_HASH", "INVALID_OPAQUE_PURPOSE"];
export type AuthRuntimeErrorCode = (typeof codes)[number];
/** Deliberately carries no input, cause, library error, status or application policy. */
export declare class AuthRuntimeError extends Error {
    readonly code: AuthRuntimeErrorCode;
    constructor(code: AuthRuntimeErrorCode);
}
export {};

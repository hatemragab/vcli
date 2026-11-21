export interface TrustedHs256Key {
    readonly id: string;
    /** Independently generated CSPRNG bytes, never a password or UTF8 application secret. */
    readonly key: Uint8Array;
}
export interface JwtPolicy {
    readonly issuer: string;
    readonly audience: string;
    readonly activeSigningKeyId: string;
    readonly keys: readonly TrustedHs256Key[];
    readonly maxLifetimeSeconds?: number;
    readonly maxFutureIssuedSeconds?: number;
}
export interface JwtPolicyFacts {
    readonly issuer: string;
    readonly audience: string;
    readonly activeSigningKeyId: string;
    readonly acceptedKeyIds: readonly string[];
    readonly maxLifetimeSeconds: number;
    readonly maxFutureIssuedSeconds: number;
}
export declare function generateHs256Key(): Uint8Array;
export declare function validateJwtPolicy(input: JwtPolicy): {
    facts: Readonly<JwtPolicyFacts>;
    keys: ReadonlyMap<string, Uint8Array>;
};
export declare function isIdentifier(value: unknown): value is string;
/** Explicit epoch milliseconds; rejecting invalid Date ranges prevents hidden clock fallback. */
export declare function isEpochMilliseconds(value: unknown): value is number;

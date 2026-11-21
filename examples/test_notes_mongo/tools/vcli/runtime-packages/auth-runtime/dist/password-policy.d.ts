export interface PasswordPolicy {
    readonly algorithm: 'argon2id';
    readonly version: 19;
    readonly memoryCostKiB: number;
    readonly timeCost: number;
    readonly parallelism: number;
    readonly hashLength: number;
    readonly saltLength: number;
    readonly maxConcurrent: number;
    readonly maxPasswordBytes: number;
}
export declare const DEFAULT_PASSWORD_POLICY: Readonly<PasswordPolicy>;
export declare function validatePasswordPolicy(input: Partial<PasswordPolicy>): Readonly<PasswordPolicy>;
export declare function validatePassword(password: string, maxBytes: number): void;

import type { PasswordPolicy } from './password-policy.js';
export declare class ArgonPasswords {
    #private;
    readonly policy: Readonly<PasswordPolicy>;
    readonly measuredHashMs: number;
    private constructor();
    static create(input?: Partial<PasswordPolicy>): Promise<ArgonPasswords>;
    hash(password: string): Promise<string>;
    verify(storedHash: string, password: string): Promise<boolean>;
    needsRehash(storedHash: string): boolean;
    /** Performs the same bounded verifier work; account-existence mapping belongs to the app. */
    verifyDummy(password: string): Promise<void>;
    private bounded;
}

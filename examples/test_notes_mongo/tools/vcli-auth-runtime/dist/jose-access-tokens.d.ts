import type { JwtPolicy, JwtPolicyFacts } from './jwt-policy.js';
import type { AccessTokenInput, AccessTokenFacts } from './access-token-facts.js';
/** Cryptographic facts only; a valid JWT does not establish current session authority. */
export declare class JoseAccessTokens {
    #private;
    readonly policy: Readonly<JwtPolicyFacts>;
    constructor(input: JwtPolicy);
    issue(input: AccessTokenInput): Promise<string>;
    verify(token: string, now: number): Promise<Readonly<AccessTokenFacts>>;
}

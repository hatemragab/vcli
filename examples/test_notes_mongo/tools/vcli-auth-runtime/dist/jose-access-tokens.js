import { SignJWT, jwtVerify } from 'jose';
import { AuthRuntimeError } from './errors.js';
import { isEpochMilliseconds, isIdentifier, validateJwtPolicy, } from './jwt-policy.js';
const claims = ['sub', 'sid', 'iid', 'iss', 'aud', 'iat', 'exp'];
/** Cryptographic facts only; a valid JWT does not establish current session authority. */
export class JoseAccessTokens {
    #keys;
    policy;
    constructor(input) {
        const validated = validateJwtPolicy(input);
        this.#keys = validated.keys;
        this.policy = validated.facts;
        Object.freeze(this);
    }
    async issue(input) {
        if (!input ||
            !isIdentifier(input.accountId) ||
            !isIdentifier(input.sessionId) ||
            !isIdentifier(input.installationId) ||
            !isEpochMilliseconds(input.now) ||
            !isEpochMilliseconds(input.expiresAt))
            throw new AuthRuntimeError('TOKEN_INPUT_INVALID');
        const now = Math.floor(input.now / 1000);
        const expiresAt = Math.floor(input.expiresAt / 1000);
        if (expiresAt <= now || expiresAt - now > this.policy.maxLifetimeSeconds)
            throw new AuthRuntimeError('TOKEN_INPUT_INVALID');
        try {
            return await new SignJWT({
                sid: input.sessionId,
                iid: input.installationId,
            })
                .setProtectedHeader({
                alg: 'HS256',
                typ: 'JWT',
                kid: this.policy.activeSigningKeyId,
            })
                .setSubject(input.accountId)
                .setIssuer(this.policy.issuer)
                .setAudience(this.policy.audience)
                .setIssuedAt(now)
                .setExpirationTime(expiresAt)
                .sign(this.#keys.get(this.policy.activeSigningKeyId));
        }
        catch {
            throw new AuthRuntimeError('CRYPTO_FAILURE');
        }
    }
    async verify(token, now) {
        try {
            if (!isEpochMilliseconds(now) ||
                typeof token !== 'string' ||
                token.length > 4096 ||
                !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token))
                throw new Error();
            const { payload } = await jwtVerify(token, (header) => {
                if (Object.keys(header).length !== 3 ||
                    header.alg !== 'HS256' ||
                    header.typ !== 'JWT' ||
                    !isIdentifier(header.kid))
                    throw new Error();
                const key = this.#keys.get(header.kid);
                if (!key)
                    throw new Error();
                return key;
            }, {
                algorithms: ['HS256'],
                typ: 'JWT',
                issuer: this.policy.issuer,
                audience: this.policy.audience,
                currentDate: new Date(now),
                clockTolerance: 0,
                requiredClaims: claims,
            });
            const secondsNow = Math.floor(now / 1000);
            if (Object.keys(payload).length !== claims.length ||
                payload.iss !== this.policy.issuer ||
                payload.aud !== this.policy.audience ||
                !isIdentifier(payload.sub) ||
                !isIdentifier(payload.sid) ||
                !isIdentifier(payload.iid) ||
                !isNumericDate(payload.iat) ||
                !isNumericDate(payload.exp) ||
                payload.iat > secondsNow + this.policy.maxFutureIssuedSeconds ||
                payload.exp <= secondsNow ||
                payload.exp <= payload.iat ||
                payload.exp - payload.iat > this.policy.maxLifetimeSeconds)
                throw new Error();
            return Object.freeze({
                accountId: payload.sub,
                sessionId: payload.sid,
                installationId: payload.iid,
                issuedAt: payload.iat * 1000,
                expiresAt: payload.exp * 1000,
            });
        }
        catch {
            throw new AuthRuntimeError('INVALID_ACCESS_TOKEN');
        }
    }
}
function isNumericDate(value) {
    return (typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 8640000000000);
}

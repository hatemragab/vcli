import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthRuntimeError } from './errors.js';
export function generateHs256Key() {
    try {
        return Uint8Array.from(randomBytes(32));
    }
    catch {
        throw new AuthRuntimeError('CRYPTO_FAILURE');
    }
}
export function validateJwtPolicy(input) {
    if (!input ||
        typeof input !== 'object' ||
        !isLabel(input.issuer) ||
        !isLabel(input.audience) ||
        !isIdentifier(input.activeSigningKeyId) ||
        !Array.isArray(input.keys) ||
        input.keys.length < 1 ||
        input.keys.length > 4)
        throw new AuthRuntimeError('JWT_POLICY_INVALID');
    const maxLifetimeSeconds = input.maxLifetimeSeconds ?? 900;
    const maxFutureIssuedSeconds = input.maxFutureIssuedSeconds ?? 0;
    if (!Number.isSafeInteger(maxLifetimeSeconds) ||
        maxLifetimeSeconds < 1 ||
        maxLifetimeSeconds > 86400 ||
        !Number.isSafeInteger(maxFutureIssuedSeconds) ||
        maxFutureIssuedSeconds < 0 ||
        maxFutureIssuedSeconds > 60)
        throw new AuthRuntimeError('JWT_POLICY_INVALID');
    const keys = new Map();
    for (const entry of input.keys) {
        if (!entry ||
            !isIdentifier(entry.id) ||
            keys.has(entry.id) ||
            !(entry.key instanceof Uint8Array) ||
            entry.key.length !== 32 ||
            new Set(entry.key).size < 16)
            throw new AuthRuntimeError('JWT_POLICY_INVALID');
        const copy = Uint8Array.from(entry.key);
        if ([...keys.values()].some((other) => timingSafeEqual(copy, other)))
            throw new AuthRuntimeError('JWT_POLICY_INVALID');
        keys.set(entry.id, copy);
    }
    if (!keys.has(input.activeSigningKeyId))
        throw new AuthRuntimeError('JWT_POLICY_INVALID');
    return {
        facts: Object.freeze({
            issuer: input.issuer,
            audience: input.audience,
            activeSigningKeyId: input.activeSigningKeyId,
            acceptedKeyIds: Object.freeze([...keys.keys()]),
            maxLifetimeSeconds,
            maxFutureIssuedSeconds,
        }),
        keys,
    };
}
export function isIdentifier(value) {
    return (typeof value === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value));
}
function isLabel(value) {
    return (typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 256 &&
        value.isWellFormed() &&
        [...value].every((character) => {
            const point = character.codePointAt(0);
            return point > 32 && point !== 127;
        }));
}
/** Explicit epoch milliseconds; rejecting invalid Date ranges prevents hidden clock fallback. */
export function isEpochMilliseconds(value) {
    return (typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value <= 8640000000000000);
}

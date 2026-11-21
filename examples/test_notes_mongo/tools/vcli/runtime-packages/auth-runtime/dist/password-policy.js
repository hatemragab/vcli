import { AuthRuntimeError } from './errors.js';
export const DEFAULT_PASSWORD_POLICY = Object.freeze({
    algorithm: 'argon2id',
    version: 19,
    memoryCostKiB: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
    saltLength: 16,
    maxConcurrent: 2,
    maxPasswordBytes: 1024,
});
export function validatePasswordPolicy(input) {
    if (!input ||
        typeof input !== 'object' ||
        Object.keys(input).some((key) => !Object.hasOwn(DEFAULT_PASSWORD_POLICY, key)))
        throw new AuthRuntimeError('PASSWORD_POLICY_INVALID');
    const policy = { ...DEFAULT_PASSWORD_POLICY, ...input };
    const ranges = [
        [policy.memoryCostKiB, 19456, 65536],
        [policy.timeCost, 2, 5],
        [policy.parallelism, 1, 2],
        [policy.hashLength, 32, 64],
        [policy.saltLength, 16, 32],
        [policy.maxConcurrent, 1, 2],
        [policy.maxPasswordBytes, 64, 4096],
    ];
    if (policy.algorithm !== 'argon2id' ||
        policy.version !== 19 ||
        ranges.some(([value, min, max]) => !Number.isSafeInteger(value) || value < min || value > max))
        throw new AuthRuntimeError('PASSWORD_POLICY_INVALID');
    return Object.freeze(policy);
}
export function validatePassword(password, maxBytes) {
    if (typeof password !== 'string' ||
        password.length > maxBytes ||
        !password.isWellFormed() ||
        Buffer.byteLength(password, 'utf8') > maxBytes)
        throw new AuthRuntimeError('PASSWORD_INPUT_INVALID');
}

import { argon2id, hash, needsRehash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AuthRuntimeError } from './errors.js';
import { validatePassword, validatePasswordPolicy } from './password-policy.js';
import { inspectStoredPassword } from './stored-password.js';
export class ArgonPasswords {
    #active = 0;
    #dummyHash;
    policy;
    measuredHashMs;
    constructor(policy, dummyHash, measuredHashMs) {
        this.policy = policy;
        this.#dummyHash = dummyHash;
        this.measuredHashMs = measuredHashMs;
        Object.freeze(this);
    }
    static async create(input = {}) {
        const policy = validatePasswordPolicy(input);
        const start = performance.now();
        try {
            const dummyHash = await hash(randomBytes(32), {
                ...argonOptions(policy),
                salt: randomBytes(policy.saltLength),
            });
            inspectStoredPassword(dummyHash);
            return new ArgonPasswords(policy, dummyHash, performance.now() - start);
        }
        catch {
            throw new AuthRuntimeError('CRYPTO_FAILURE');
        }
    }
    async hash(password) {
        validatePassword(password, this.policy.maxPasswordBytes);
        return this.bounded(async () => hash(password, {
            ...argonOptions(this.policy),
            salt: randomBytes(this.policy.saltLength),
        }));
    }
    async verify(storedHash, password) {
        validatePassword(password, this.policy.maxPasswordBytes);
        inspectStoredPassword(storedHash);
        return this.bounded(() => verify(storedHash, password));
    }
    needsRehash(storedHash) {
        const facts = inspectStoredPassword(storedHash);
        try {
            return (needsRehash(storedHash, argonOptions(this.policy)) ||
                facts.hashLength !== this.policy.hashLength ||
                facts.saltLength !== this.policy.saltLength);
        }
        catch {
            throw new AuthRuntimeError('CREDENTIAL_STORAGE_INVALID');
        }
    }
    /** Performs the same bounded verifier work; account-existence mapping belongs to the app. */
    async verifyDummy(password) {
        validatePassword(password, this.policy.maxPasswordBytes);
        await this.bounded(() => verify(this.#dummyHash, password));
    }
    async bounded(work) {
        if (this.#active >= this.policy.maxConcurrent)
            throw new AuthRuntimeError('HASH_CAPACITY');
        this.#active++;
        try {
            return await work();
        }
        catch {
            throw new AuthRuntimeError('CRYPTO_FAILURE');
        }
        finally {
            this.#active--;
        }
    }
}
function argonOptions(policy) {
    return {
        type: argon2id,
        version: policy.version,
        memoryCost: policy.memoryCostKiB,
        timeCost: policy.timeCost,
        parallelism: policy.parallelism,
        hashLength: policy.hashLength,
    };
}

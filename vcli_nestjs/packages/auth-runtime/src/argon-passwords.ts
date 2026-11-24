import { argon2id, hash, needsRehash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AuthRuntimeError } from './errors.js';
import { validatePassword, validatePasswordPolicy } from './password-policy.js';
import type { PasswordPolicy } from './password-policy.js';
import { inspectStoredPassword } from './stored-password.js';

export class ArgonPasswords {
  #active = 0;
  readonly #dummyHash: string;
  readonly policy: Readonly<PasswordPolicy>;
  readonly measuredHashMs: number;

  private constructor(
    policy: Readonly<PasswordPolicy>,
    dummyHash: string,
    measuredHashMs: number,
  ) {
    this.policy = policy;
    this.#dummyHash = dummyHash;
    this.measuredHashMs = measuredHashMs;
    Object.freeze(this);
  }

  static async create(
    input: Partial<PasswordPolicy> = {},
  ): Promise<ArgonPasswords> {
    const policy = validatePasswordPolicy(input);
    const start = performance.now();
    try {
      const dummyHash = await hash(randomBytes(32), {
        ...argonOptions(policy),
        salt: randomBytes(policy.saltLength),
      });
      inspectStoredPassword(dummyHash);
      return new ArgonPasswords(policy, dummyHash, performance.now() - start);
    } catch {
      throw new AuthRuntimeError('CRYPTO_FAILURE');
    }
  }

  async hash(password: string): Promise<string> {
    validatePassword(password, this.policy.maxPasswordBytes);
    return this.bounded(async () =>
      hash(password, {
        ...argonOptions(this.policy),
        salt: randomBytes(this.policy.saltLength),
      }),
    );
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    validatePassword(password, this.policy.maxPasswordBytes);
    inspectStoredPassword(storedHash);
    return this.bounded(() => verify(storedHash, password));
  }

  needsRehash(storedHash: string): boolean {
    const facts = inspectStoredPassword(storedHash);
    try {
      return (
        needsRehash(storedHash, argonOptions(this.policy)) ||
        facts.hashLength !== this.policy.hashLength ||
        facts.saltLength !== this.policy.saltLength
      );
    } catch {
      throw new AuthRuntimeError('CREDENTIAL_STORAGE_INVALID');
    }
  }

  /** Performs the same bounded verifier work; account-existence mapping belongs to the app. */
  async verifyDummy(password: string): Promise<void> {
    validatePassword(password, this.policy.maxPasswordBytes);
    await this.bounded(() => verify(this.#dummyHash, password));
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.policy.maxConcurrent)
      throw new AuthRuntimeError('HASH_CAPACITY');
    this.#active++;
    try {
      return await work();
    } catch {
      throw new AuthRuntimeError('CRYPTO_FAILURE');
    } finally {
      this.#active--;
    }
  }
}

function argonOptions(policy: Readonly<PasswordPolicy>) {
  return {
    type: argon2id,
    version: policy.version,
    memoryCost: policy.memoryCostKiB,
    timeCost: policy.timeCost,
    parallelism: policy.parallelism,
    hashLength: policy.hashLength,
  } as const;
}

import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { performance } from 'node:perf_hooks';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Passwords } from './credential-ports.js';
import { newSecret } from './secret-facts.js';
/** Fixed resource policy: 19 MiB per hash, two passes, one lane, at most two concurrent jobs. */
@Injectable()
export class ArgonPasswords implements Passwords {
  private active = 0;
  private constructor(
    readonly dummyHash: string,
    readonly measuredHashMs: number,
  ) {}
  static readonly options: argon2.HashOptions = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  };
  static async create(): Promise<ArgonPasswords> {
    const start = performance.now();
    const dummyHash = await argon2.hash(newSecret(), ArgonPasswords.options);
    return new ArgonPasswords(dummyHash, Math.ceil(performance.now() - start));
  }
  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) throw new ApplicationError('HASH_CAPACITY', 429);
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
  async hash(password: string): Promise<string> {
    return this.bounded(() => argon2.hash(password, ArgonPasswords.options));
  }
  async verify(hash: string, password: string): Promise<boolean> {
    // Stored hashes are owner-written only. Refuse corrupted/resource-inflated records.
    const header = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/u.exec(hash);
    if (
      !header ||
      Number(header[1]) > 65536 ||
      Number(header[2]) > 5 ||
      Number(header[3]) > 2
    )
      throw new ApplicationError('CREDENTIAL_STORAGE_INVALID', 503);
    return this.bounded(() => argon2.verify(hash, password));
  }
  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ArgonPasswords.options);
  }
}

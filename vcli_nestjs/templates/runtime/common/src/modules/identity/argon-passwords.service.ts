import { validPasswordInput } from '../../core/auth/password-input.js';
import { Injectable } from '@nestjs/common';
import {
  ArgonPasswords as RuntimePasswords,
  type PasswordPolicy,
} from '@vcli/auth-runtime/password';
import { authRuntimeError } from '../../core/auth/auth-runtime-error.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Passwords } from './credential-ports.js';
/** One runtime per process, sharing hash/verify/dummy admission slots. */
@Injectable()
export class ArgonPasswords implements Passwords {
  private constructor(private readonly runtime: RuntimePasswords) {}
  static async create(
    policy: Partial<PasswordPolicy> = {},
  ): Promise<ArgonPasswords> {
    try {
      return new ArgonPasswords(
        await RuntimePasswords.create({ ...policy, maxPasswordBytes: 256 }),
      );
    } catch (error) {
      return authRuntimeError(error);
    }
  }
  get measuredHashMs(): number {
    return this.runtime.measuredHashMs;
  }
  get policy(): Readonly<PasswordPolicy> {
    return this.runtime.policy;
  }
  private input(password: string): void {
    if (!validPasswordInput(password))
      throw new ApplicationError('PASSWORD_INPUT_INVALID', 400);
  }
  async hash(password: string): Promise<string> {
    this.input(password);
    try {
      return await this.runtime.hash(password);
    } catch (error) {
      return authRuntimeError(error);
    }
  }
  async verify(hash: string, password: string): Promise<boolean> {
    this.input(password);
    try {
      return await this.runtime.verify(hash, password);
    } catch (error) {
      return authRuntimeError(error);
    }
  }
  async verifyDummy(password: string): Promise<void> {
    this.input(password);
    try {
      await this.runtime.verifyDummy(password);
    } catch (error) {
      authRuntimeError(error);
    }
  }
  needsRehash(hash: string): boolean {
    try {
      return this.runtime.needsRehash(hash);
    } catch (error) {
      return authRuntimeError(error);
    }
  }
}

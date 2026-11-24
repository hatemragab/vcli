import { Injectable } from '@nestjs/common';
import {
  JoseAccessTokens as RuntimeTokens,
  type JwtPolicy,
} from '@vcli/auth-runtime/jwt';
import { authRuntimeError } from '../../core/auth/auth-runtime-error.js';
import type { AccessTokens } from './credential-ports.js';
@Injectable()
export class JoseAccessTokens implements AccessTokens {
  private readonly runtime: RuntimeTokens;
  constructor(policy: JwtPolicy) {
    try {
      this.runtime = new RuntimeTokens(policy);
    } catch (error) {
      authRuntimeError(error);
    }
  }
  async issue(input: Parameters<AccessTokens['issue']>[0]): Promise<string> {
    try {
      return await this.runtime.issue(input);
    } catch (error) {
      return authRuntimeError(error);
    }
  }
  async verify(token: string, now: number) {
    try {
      return await this.runtime.verify(token, now);
    } catch (error) {
      return authRuntimeError(error);
    }
  }
}

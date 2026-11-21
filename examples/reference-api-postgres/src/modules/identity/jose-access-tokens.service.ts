import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { AccessTokens } from './credential-ports.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class JoseAccessTokens implements AccessTokens {
  private readonly key: Uint8Array;
  constructor(
    secret: string,
    private readonly issuer: string,
    private readonly audience: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }
  async issue(input: Parameters<AccessTokens['issue']>[0]): Promise<string> {
    return new SignJWT({ sid: input.sessionId, iid: input.installationId })
      .setProtectedHeader({ alg: 'HS256', kid: 'local-v1', typ: 'JWT' })
      .setSubject(input.accountId)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(Math.floor(input.now / 1000))
      .setExpirationTime(Math.floor(input.expiresAt / 1000))
      .sign(this.key);
  }
  async verify(token: string, now: number) {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['HS256'],
        typ: 'JWT',
        currentDate: new Date(now),
        requiredClaims: ['sub', 'sid', 'iid', 'exp', 'iat'],
      });
      if (
        protectedHeader.kid !== 'local-v1' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.iid !== 'string' ||
        typeof payload.exp !== 'number' ||
        typeof payload.iat !== 'number' ||
        payload.iat > Math.floor(now / 1000)
      )
        throw new Error('claims');
      return {
        accountId: payload.sub,
        sessionId: payload.sid,
        installationId: payload.iid,
        expiresAt: payload.exp * 1000,
      };
    } catch {
      throw new ApplicationError('INVALID_ACCESS_TOKEN', 401);
    }
  }
}

import type { JwtPolicy } from '@vcli/auth-runtime/jwt';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';

const claims = ['sub', 'iss', 'aud', 'iat', 'exp'];
const keyId = /^[A-Za-z0-9_-]{1,40}$/u;
const accountId = z.uuidv4();

/** Account bearer tokens for the basic local auth profile. */
export class AuthTokenService {
  private readonly keys: ReadonlyMap<string, Uint8Array>;
  private readonly signingKey: Uint8Array;
  private readonly policy: Pick<
    JwtPolicy,
    'issuer' | 'audience' | 'activeSigningKeyId'
  >;
  private readonly maxLifetimeSeconds: number;
  private readonly maxFutureIssuedSeconds: number;

  constructor(
    policy: JwtPolicy,
    private readonly accessTtlSeconds: number,
  ) {
    const { keys, activeSigningKeyId, issuer, audience } = policy;
    this.maxLifetimeSeconds = policy.maxLifetimeSeconds ?? 900;
    this.maxFutureIssuedSeconds = policy.maxFutureIssuedSeconds ?? 0;
    if (
      !validLabel(issuer) ||
      !validLabel(audience) ||
      !boundedInteger(this.maxLifetimeSeconds, 1, 86400) ||
      !boundedInteger(this.maxFutureIssuedSeconds, 0, 60) ||
      !boundedInteger(accessTtlSeconds, 1, this.maxLifetimeSeconds) ||
      keys.length < 1 ||
      keys.length > 4 ||
      keys.some(
        ({ id, key }) =>
          !keyId.test(id) || key.length !== 32 || new Set(key).size < 16,
      )
    )
      throw new ApplicationError('INVALID_JWT_POLICY', 500);

    this.keys = new Map(keys.map(({ id, key }) => [id, Uint8Array.from(key)]));
    const signingKey = this.keys.get(activeSigningKeyId);
    if (
      !signingKey ||
      this.keys.size !== keys.length ||
      new Set(keys.map(({ key }) => Buffer.from(key).toString('base64url')))
        .size !== keys.length
    )
      throw new ApplicationError('INVALID_JWT_POLICY', 500);
    this.signingKey = signingKey;
    this.policy = { issuer, audience, activeSigningKeyId };
  }

  async issue(id: string, now = Date.now()) {
    const issuedAt = Math.floor(now / 1000);
    const expiresAt = issuedAt + this.accessTtlSeconds;
    try {
      const accessToken = await new SignJWT({})
        .setProtectedHeader({
          alg: 'HS256',
          typ: 'JWT',
          kid: this.policy.activeSigningKeyId,
        })
        .setSubject(id)
        .setIssuer(this.policy.issuer)
        .setAudience(this.policy.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(this.signingKey);
      return {
        accessToken,
        tokenType: 'Bearer' as const,
        expiresAt: expiresAt * 1000,
      };
    } catch {
      throw new ApplicationError('AUTH_CRYPTO_UNAVAILABLE', 503);
    }
  }

  async verify(token: string, now = Date.now()): Promise<string> {
    const unauthenticated = new ApplicationError('UNAUTHENTICATED', 401);
    if (
      token.length > 4096 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)
    )
      throw unauthenticated;

    try {
      const { payload } = await jwtVerify(
        token,
        (header) => {
          const key = header.kid && this.keys.get(header.kid);
          if (!key || Object.keys(header).length !== 3 || header.typ !== 'JWT')
            throw unauthenticated;
          return key;
        },
        {
          algorithms: ['HS256'],
          issuer: this.policy.issuer,
          audience: this.policy.audience,
          currentDate: new Date(now),
          requiredClaims: claims,
        },
      );
      const { sub, aud, iat, exp } = payload;
      if (
        Object.keys(payload).length !== claims.length ||
        aud !== this.policy.audience ||
        !boundedInteger(iat, 0, 8640000000000) ||
        !boundedInteger(exp, iat + 1, iat + this.maxLifetimeSeconds) ||
        iat > Math.floor(now / 1000) + this.maxFutureIssuedSeconds
      )
        throw unauthenticated;
      return accountId.parse(sub);
    } catch {
      throw unauthenticated;
    }
  }
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function validLabel(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    [...value].every((character) => character > ' ' && character !== '\u007f')
  );
}

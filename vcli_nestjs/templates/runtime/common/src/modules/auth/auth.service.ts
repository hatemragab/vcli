import { createHash, randomUUID } from 'node:crypto';
import type { ArgonPasswords } from '@vcli/auth-runtime/password';
import { authRuntimeError } from '../../core/auth/auth-runtime-error.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { AuthIdentifier } from './auth-inputs.js';
import type { AuthTokenService } from './auth-token.service.js';
import type { AuthRepository } from './auth.repository.js';
import type { RedisIdentityRateStore } from './redis-identity-rate-store.js';

export type AuthAccountProfile = Readonly<
  { id: string; createdAt: number } & ({ email: string } | { username: string })
>;

type Credentials = Readonly<{ identifier: string; password: string }>;
const quotas = {
  register: { ip: 10, identifier: 3 },
  login: { ip: 20, identifier: 6 },
};

export class AuthService {
  constructor(
    readonly identifierKind: AuthIdentifier,
    private readonly accounts: Pick<
      AuthRepository,
      'create' | 'findByIdentifier' | 'findById'
    >,
    private readonly passwords: Pick<
      ArgonPasswords,
      'hash' | 'verify' | 'verifyDummy'
    >,
    private readonly tokens: Pick<AuthTokenService, 'issue' | 'verify'>,
    private readonly rates: Pick<RedisIdentityRateStore, 'spend'>,
  ) {}

  async register(
    { identifier, password }: Credentials,
    ip: string,
  ): Promise<void> {
    await this.spend('register', ip, identifier);
    const passwordHash = await this.passwords
      .hash(password)
      .catch(authRuntimeError);
    try {
      await this.accounts.create({
        id: randomUUID(),
        identifier,
        passwordHash,
        createdAt: Date.now(),
      });
    } catch (error) {
      // Duplicate registration has the same response and preserves the credential.
      if (!(
        error instanceof ApplicationError && error.code === 'IDENTITY_EXISTS'
      ))
        throw error;
    }
  }

  async login({ identifier, password }: Credentials, ip: string) {
    await this.spend('login', ip, identifier);
    const account = await this.accounts.findByIdentifier(identifier);
    if (!account) {
      await this.passwords.verifyDummy(password).catch(authRuntimeError);
      throw new ApplicationError('INVALID_CREDENTIALS', 401);
    }
    if (
      !(await this.passwords
        .verify(account.passwordHash, password)
        .catch(authRuntimeError))
    )
      throw new ApplicationError('INVALID_CREDENTIALS', 401);
    return this.tokens.issue(account.id);
  }

  async authenticate(token: string): Promise<AuthAccountProfile> {
    const id = await this.tokens.verify(token);
    const account = await this.accounts.findById(id);
    if (!account) throw new ApplicationError('UNAUTHENTICATED', 401);
    const profile = { id: account.id, createdAt: account.createdAt };
    return this.identifierKind === 'email'
      ? { ...profile, email: account.identifier }
      : { ...profile, username: account.identifier };
  }

  private spend(
    operation: keyof typeof quotas,
    ip: string,
    identifier: string,
  ) {
    const quota = quotas[operation];
    return this.rates.spend([
      { key: rateKey(operation, 'ip', ip), limit: quota.ip },
      {
        key: rateKey(operation, 'identifier', identifier),
        limit: quota.identifier,
      },
    ]);
  }
}

function rateKey(operation: string, scope: string, value: string): string {
  return createHash('sha256')
    .update(`basic:${operation}:${scope}:${value}`)
    .digest('hex');
}

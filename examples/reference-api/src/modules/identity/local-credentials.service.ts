import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { IdentityService } from './identity.service.js';
import type { Passwords } from './credential-ports.js';
import type { SessionFacts } from '../sessions/session-facts.js';
import type { Session } from '../sessions/session.entity.js';
import type { SessionIssuer } from '../sessions/session-issuer.service.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class LocalCredentials {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly passwords: Passwords,
    private readonly issuer: Pick<SessionIssuer, 'issue'>,
  ) {}
  async register(
    email: string,
    password: string,
    accountId: string,
    now: number,
  ): Promise<void> {
    const hash = await this.passwords.hash(password);
    try {
      await this.tx.run(async (ctx) => {
        if (await this.identities.find('local:' + email, ctx)) return;
        await this.accounts.create(
          {
            id: accountId,
            email,
            emailVerified: false,
            enabled: true,
            createdAt: now,
          },
          { context: ctx },
        );
        await this.identities.create(
          {
            key: 'local:' + email,
            accountId,
            passwordHash: hash,
            credentialVersion: 1,
            enrollmentCutoff: 0,
          },
          ctx,
        );
      });
    } catch (error) {
      if (!(
        error instanceof ApplicationError &&
        (error.code === 'IDENTITY_EXISTS' ||
          error.code === 'DUPLICATE_IDENTITY')
      ))
        throw error;
    }
  }
  async login(
    email: string,
    password: string,
    facts: SessionFacts,
  ): Promise<Session> {
    const identity = await this.tx.run((ctx) =>
      this.identities.find('local:' + email, ctx),
    );
    const valid = await this.passwords.verify(
      identity?.passwordHash ?? this.passwords.dummyHash,
      password,
    );
    if (!valid || !identity?.passwordHash)
      throw new ApplicationError('INVALID_CREDENTIALS', 401);
    const replacement = this.passwords.needsRehash(identity.passwordHash)
      ? await this.passwords.hash(password)
      : null;
    return this.tx.run(async (ctx) => {
      const account = await this.accounts.lock(identity.accountId, ctx);
      const current = await this.identities.find(identity.key, ctx);
      if (
        !account?.enabled ||
        current?.credentialVersion !== identity.credentialVersion ||
        current.passwordHash !== identity.passwordHash
      )
        throw new ApplicationError('INVALID_CREDENTIALS', 401);
      if (!account.emailVerified)
        throw new ApplicationError('EMAIL_VERIFICATION_REQUIRED', 403);
      if (
        replacement &&
        !(await this.identities.replacePassword(
          identity.key,
          identity.credentialVersion,
          replacement,
          ctx,
        ))
      )
        throw new ApplicationError('CREDENTIAL_CONFLICT', 409);
      return this.issuer.issue(
        account.id,
        identity.key,
        'local',
        'password',
        facts.now,
        facts,
        ctx,
      );
    });
  }
}

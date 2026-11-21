import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { IdentityService } from './identity.service.js';
import type { Passwords } from './credential-ports.js';
import type { SessionFacts } from '../sessions/session-facts.js';
import type { SessionRecord } from '../../core/auth/session-record.js';
import type { SessionIssuer } from '../sessions/session-issuer.service.js';
import { ApplicationError } from '../../core/errors/application-error.js';

/** Password possession authenticates a username; it makes no email ownership claim. */
@Injectable()
export class UsernameCredentials {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly passwords: Passwords,
    private readonly issuer: Pick<SessionIssuer, 'issue'>,
  ) {}

  async register(
    username: string,
    password: string,
    accountId: string,
    now: number,
  ): Promise<void> {
    // Hash once before entering the native driver's retryable transaction.
    const hash = await this.passwords.hash(password);
    try {
      await this.tx.run(async (context) => {
        if (await this.identities.find('username:' + username, context)) return;
        await this.accounts.create(
          {
            id: accountId,
            email: null,
            emailVerified: false,
            enabled: true,
            createdAt: now,
          },
          { context },
        );
        await this.identities.create(
          {
            key: 'username:' + username,
            accountId,
            passwordHash: hash,
            credentialVersion: 1,
            enrollmentCutoff: 0,
            generation: 1,
            active: true,
            methods: ['password'],
            cleanupPending: false,
          },
          context,
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
    username: string,
    password: string,
    facts: SessionFacts,
  ): Promise<SessionRecord> {
    const identity = await this.tx.run((context) =>
      this.identities.find('username:' + username, context),
    );
    const valid = identity?.passwordHash
      ? await this.passwords.verify(identity.passwordHash, password)
      : (await this.passwords.verifyDummy(password), false);
    if (!valid || !identity?.passwordHash)
      throw new ApplicationError('INVALID_CREDENTIALS', 401);
    const replacement = this.passwords.needsRehash(identity.passwordHash)
      ? await this.passwords.hash(password)
      : null;
    return this.tx.run(async (context) => {
      const account = await this.accounts.lock(identity.accountId, context);
      const current = await this.identities.find(identity.key, context);
      if (
        !account?.enabled ||
        !current?.active ||
        current.cleanupPending ||
        current.credentialVersion !== identity.credentialVersion ||
        current.passwordHash !== identity.passwordHash
      )
        throw new ApplicationError('INVALID_CREDENTIALS', 401);
      if (
        replacement &&
        !(await this.identities.replacePassword(
          identity.key,
          identity.credentialVersion,
          replacement,
          context,
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
        context,
      );
    });
  }
}

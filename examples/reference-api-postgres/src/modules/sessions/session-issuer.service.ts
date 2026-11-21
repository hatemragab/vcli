import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionFacts } from './session-facts.js';
import type { SessionService } from './session.service.js';
import type { Session } from './session.entity.js';
import { ApplicationError } from '../../core/errors/application-error.js';
/** Called only inside the caller's transaction, while holding the account authority lock. */
@Injectable()
export class SessionIssuer {
  constructor(
    private readonly accounts: AccountService,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
  ) {}
  async issue(
    accountId: string,
    identityKey: string,
    kind: Session['kind'],
    method: string,
    authenticatedAt: number,
    facts: SessionFacts,
    ctx: TransactionContext,
  ): Promise<Session> {
    const account = await this.accounts.findById(accountId, { context: ctx });
    if (!account?.enabled) throw new ApplicationError('UNAUTHENTICATED', 401);
    if (
      (await this.sessions.listActive(accountId, facts.now, ctx)).length >= 100
    )
      throw new ApplicationError('SESSION_LIMIT', 429);
    await this.installations.create(
      {
        id: facts.installationId,
        accountId,
        generation: 1,
        platform: facts.platform,
        createdAt: facts.now,
      },
      { context: ctx },
    );
    const session: Session = {
      id: facts.sessionId,
      accountId,
      installationId: facts.installationId,
      kind,
      identityKey,
      method,
      authenticatedAt,
      createdAt: facts.now,
      expiresAt: facts.expiresAt,
      revokedAt: null,
      secretHash: kind === 'firebase' ? facts.secretHash : null,
    };
    await this.sessions.create(session, { context: ctx });
    if (kind === 'local')
      await this.sessions.addRefresh(
        {
          hash: facts.secretHash,
          sessionId: session.id,
          expiresAt: session.expiresAt,
          consumedAt: null,
        },
        ctx,
      );
    return session;
  }
}

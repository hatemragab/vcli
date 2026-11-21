import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionFacts } from './session-facts.js';
import type { SessionService } from './session.service.js';
import type { Session } from './session.entity.js';
import { checkSession } from './session-policy.js';
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
    enrollmentGeneration = 1,
  ): Promise<Session> {
    const account = await this.accounts.findById(accountId, { context: ctx });
    if (!account?.enabled) throw new ApplicationError('UNAUTHENTICATED', 401);
    if (
      (await this.sessions.listActive(accountId, facts.now, ctx)).length >= 100
    )
      throw new ApplicationError('SESSION_LIMIT', 429);
    const installation = await this.installations.enroll(
      facts.installationId,
      accountId,
      facts.installationCapabilityHash,
      facts.platform,
      facts.now,
      facts.allowRebind,
      ctx,
    );
    await this.sessions.revokeInstallation(
      installation.id,
      installation.generation,
      facts.now,
      ctx,
    );
    const session: Session = {
      id: facts.sessionId,
      accountId,
      installationId: installation.id,
      installationGeneration: installation.generation,
      enrollmentGeneration,
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

  /** A retained revoked/expired capability is a tombstone, never a new enrollment. */
  async recoverFirebase(
    hash: string,
    identityKey: string,
    generation: number,
    authenticatedAt: number,
    facts: SessionFacts,
    ctx: TransactionContext,
  ): Promise<Session | null> {
    const session = await this.sessions.findBySecret(hash, ctx);
    if (!session) return null;
    if (
      session.kind !== 'firebase' ||
      session.identityKey !== identityKey ||
      session.enrollmentGeneration !== generation ||
      authenticatedAt < session.authenticatedAt
    )
      throw new ApplicationError('UNAUTHENTICATED', 401);
    const installation = await this.installations.findById(
      session.installationId,
      { context: ctx },
    );
    checkSession(
      session,
      await this.accounts.findById(session.accountId, { context: ctx }),
      installation,
      facts.now,
    );
    if (installation?.capabilityHash !== facts.installationCapabilityHash)
      throw new ApplicationError('INSTALLATION_PROOF_REQUIRED', 401);
    return session;
  }
}

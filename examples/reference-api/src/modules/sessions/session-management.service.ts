import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { EnrollmentCutoff } from '../../core/auth/enrollment-cutoff.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from './session.service.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { checkSession, requireRecent } from './session-policy.js';
@Injectable()
export class SessionManagement {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: EnrollmentCutoff,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
    private readonly recentAuthMs: number,
  ) {}
  async list(actor: Principal, now: number) {
    return this.tx.run(async (ctx) => {
      const session = await this.sessions.findById(actor.sessionId, {
        context: ctx,
      });
      checkSession(
        session,
        await this.accounts.findById(actor.accountId, { context: ctx }),
        await this.installations.findById(actor.installationId, {
          context: ctx,
        }),
        now,
      );
      if (session.accountId !== actor.accountId)
        throw new ApplicationError('UNAUTHENTICATED', 401);
      return (await this.sessions.listActive(actor.accountId, now, ctx)).map(
        (r) => ({
          id: r.id,
          installationId: r.installationId,
          method: r.method,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          current: r.id === actor.sessionId,
        }),
      );
    });
  }
  async revoke(
    actor: Principal,
    scope: 'current' | 'selected' | 'others' | 'all',
    selectedId: string | undefined,
    now: number,
  ): Promise<void> {
    await this.tx.run(async (ctx) => {
      const account = await this.accounts.lock(actor.accountId, ctx);
      const current = await this.sessions.findById(actor.sessionId, {
        context: ctx,
      });
      checkSession(
        current,
        account,
        await this.installations.findById(actor.installationId, {
          context: ctx,
        }),
        now,
      );
      if (current.accountId !== actor.accountId)
        throw new ApplicationError('UNAUTHENTICATED', 401);
      if (scope !== 'current') requireRecent(current, now, this.recentAuthMs);
      const sessions = await this.sessions.listActive(
        actor.accountId,
        now,
        ctx,
      );
      if (scope === 'selected' && !sessions.some((r) => r.id === selectedId))
        throw new ApplicationError('SESSION_NOT_FOUND', 404);
      const ids = sessions
        .filter(
          (r) =>
            scope === 'all' ||
            (scope === 'current'
              ? r.id === actor.sessionId
              : scope === 'others'
                ? r.id !== actor.sessionId
                : r.id === selectedId),
        )
        .map((r) => r.id);
      await this.sessions.revoke(actor.accountId, ids, now, ctx);
      await this.identities.advanceCutoff(actor.accountId, now, ctx);
    });
  }
}

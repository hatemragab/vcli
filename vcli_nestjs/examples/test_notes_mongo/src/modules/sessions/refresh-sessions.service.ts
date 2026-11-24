import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from './session.service.js';
import type { Session } from './session.entity.js';
import { checkSession } from './session-policy.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class RefreshSessions {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
  ) {}
  async rotate(
    hash: string,
    successorHash: string,
    now: number,
  ): Promise<Session> {
    const result = await this.tx.run(async (ctx) => {
      const refresh = await this.sessions.findRefresh(hash, ctx);
      if (!refresh) return { error: 'INVALID_REFRESH' } as const;
      const original = await this.sessions.findById(refresh.sessionId, {
        context: ctx,
      });
      if (!original) return { error: 'INVALID_REFRESH' } as const;
      const account = await this.accounts.lock(original.accountId, ctx);
      const session = await this.sessions.findById(original.id, {
        context: ctx,
      });
      if (refresh.consumedAt !== null) {
        // Commit the family revocation before reporting reuse to the transport.
        await this.sessions.revoke(original.accountId, [original.id], now, ctx);
        return { error: 'REFRESH_REUSE' } as const;
      }
      checkSession(
        session,
        account,
        await this.installations.findById(original.installationId, {
          context: ctx,
        }),
        now,
      );
      if (
        session.kind !== 'local' ||
        !(await this.sessions.consumeRefresh(hash, now, ctx))
      )
        return { error: 'INVALID_REFRESH' } as const;
      await this.sessions.addRefresh(
        {
          hash: successorHash,
          sessionId: session.id,
          expiresAt: session.expiresAt,
          consumedAt: null,
        },
        ctx,
      );
      return { session } as const;
    });
    if (result.error) throw new ApplicationError(result.error, 401);
    return result.session;
  }
}

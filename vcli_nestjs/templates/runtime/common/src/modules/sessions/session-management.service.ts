import { Injectable } from '@nestjs/common';
import type {
  TransactionContext,
  Transactions,
} from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { EnrollmentCutoff } from '../../core/auth/enrollment-cutoff.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from './session.service.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { checkSession, requireRecent } from './session-policy.js';

const deviceLabels = {
  android: 'Android device',
  ios: 'iOS device',
  web: 'Web browser',
  other: 'Other device',
};

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
      await this.requireCurrent(actor, now, ctx);
      return (await this.sessions.listActive(actor.accountId, now, ctx)).map(
        (r) => ({
          id: r.id,
          installationId: r.installationId,
          installationGeneration: r.installationGeneration,
          method: r.method,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          current: r.id === actor.sessionId,
        }),
      );
    });
  }
  async listDevices(actor: Principal, now: number) {
    return this.tx.run(async (ctx) => {
      await this.requireCurrent(actor, now, ctx);
      const sessions = await this.sessions.listActive(
        actor.accountId,
        now,
        ctx,
      );
      const installations = await this.installations.listOwnedByIds(
        actor.accountId,
        [...new Set(sessions.map((session) => session.installationId))],
        ctx,
      );
      return installations
        .flatMap((installation) => {
          const matching = sessions.filter(
            (session) =>
              session.installationId === installation.id &&
              session.installationGeneration === installation.generation,
          );
          if (!matching.length) return [];
          const platform = Object.hasOwn(deviceLabels, installation.platform)
            ? installation.platform
            : 'other';
          return [
            {
              installationId: installation.id,
              installationGeneration: installation.generation,
              platform,
              label: deviceLabels[platform],
              createdAt: installation.createdAt,
              lastSignInAt: Math.max(
                ...matching.map((session) => session.createdAt),
              ),
              sessionCount: matching.length,
              current: matching.some(
                (session) => session.id === actor.sessionId,
              ),
            },
          ];
        })
        .sort(
          (left, right) =>
            Number(right.current) - Number(left.current) ||
            right.lastSignInAt - left.lastSignInAt ||
            left.installationId.localeCompare(right.installationId),
        );
    });
  }

  async revoke(
    actor: Principal,
    scope: 'current' | 'selected' | 'others' | 'all' | 'installation',
    selectedId: string | undefined,
    now: number,
  ): Promise<void> {
    await this.tx.run(async (ctx) => {
      const current = await this.requireCurrent(actor, now, ctx, true);
      if (scope !== 'current') requireRecent(current, now, this.recentAuthMs);
      const sessions = await this.sessions.listActive(
        actor.accountId,
        now,
        ctx,
      );
      if (scope === 'installation') {
        const installation = selectedId
          ? await this.installations.findById(selectedId, { context: ctx })
          : null;
        if (installation?.accountId !== actor.accountId)
          throw new ApplicationError('INSTALLATION_NOT_FOUND', 404);
        const ids = sessions
          .filter(
            (session) =>
              session.installationId === installation.id &&
              session.installationGeneration === installation.generation,
          )
          .map((session) => session.id);
        if (!ids.length)
          throw new ApplicationError('INSTALLATION_NOT_FOUND', 404);
        // The resulting session tombstones fence stale enrollment on this installation.
        await this.sessions.revoke(actor.accountId, ids, now, ctx);
        return;
      }
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

  private async requireCurrent(
    actor: Principal,
    now: number,
    ctx: TransactionContext,
    lockAccount = false,
  ) {
    const account = lockAccount
      ? await this.accounts.lock(actor.accountId, ctx)
      : await this.accounts.findById(actor.accountId, { context: ctx });
    const session = await this.sessions.findById(actor.sessionId, {
      context: ctx,
    });
    checkSession(
      session,
      account,
      await this.installations.findById(actor.installationId, { context: ctx }),
      now,
    );
    if (
      session.accountId !== actor.accountId ||
      session.installationGeneration !== actor.installationGeneration
    )
      throw new ApplicationError('UNAUTHENTICATED', 401);
    return session;
  }
}

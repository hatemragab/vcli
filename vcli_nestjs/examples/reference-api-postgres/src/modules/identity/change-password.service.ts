import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { IdentityService } from './identity.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from '../sessions/session.service.js';
import type { Principal } from '../../core/auth/principal.js';
import type { Passwords } from './credential-ports.js';
import { checkSession, requireRecent } from '../sessions/session-policy.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class ChangePassword {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
    private readonly passwords: Passwords,
    private readonly recentAuthMs: number,
  ) {}
  async change(
    actor: Principal,
    currentPassword: string,
    newPassword: string,
    now: number,
  ): Promise<void> {
    const identity = await this.tx.run(async (ctx) => {
      const session = await this.sessions.findById(actor.sessionId, {
        context: ctx,
      });
      if (
        !session ||
        session.kind !== 'local' ||
        session.accountId !== actor.accountId
      )
        throw new ApplicationError('UNAUTHENTICATED', 401);
      return this.identities.find(session.identityKey, ctx);
    });
    if (
      !identity?.passwordHash ||
      !(await this.passwords.verify(identity.passwordHash, currentPassword))
    )
      throw new ApplicationError('INVALID_CREDENTIALS', 401);
    const hash = await this.passwords.hash(newPassword);
    await this.tx.run(async (ctx) => {
      const account = await this.accounts.lock(actor.accountId, ctx),
        session = await this.sessions.findById(actor.sessionId, {
          context: ctx,
        });
      checkSession(
        session,
        account,
        await this.installations.findById(actor.installationId, {
          context: ctx,
        }),
        now,
      );
      if (session.accountId !== actor.accountId)
        throw new ApplicationError('UNAUTHENTICATED', 401);
      requireRecent(session, now, this.recentAuthMs);
      if (
        !(await this.identities.replacePassword(
          identity.key,
          identity.credentialVersion,
          hash,
          ctx,
        ))
      )
        throw new ApplicationError('CREDENTIAL_CONFLICT', 409);
      await this.sessions.revoke(
        actor.accountId,
        (await this.sessions.listActive(actor.accountId, now, ctx)).map(
          (r) => r.id,
        ),
        now,
        ctx,
      );
      await this.identities.advanceCutoff(actor.accountId, now, ctx);
    });
  }
}

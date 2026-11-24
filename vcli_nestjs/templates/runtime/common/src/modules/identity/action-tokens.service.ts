import type { ActionDeliveryWriter } from '../../core/mail/action-delivery.js';
import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { IdentityService } from './identity.service.js';
import type { Action } from './identity.entity.js';
import type { SessionService } from '../sessions/session.service.js';
import type {
  MailMessage,
  MailOutcome,
  MailSubmitter,
} from '../../core/mail/mail-submitter.js';
import type { Passwords } from './credential-ports.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class ActionTokens {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly sessions: SessionService,
    private readonly passwords: Passwords,
    private readonly mail: MailSubmitter,
    private readonly delivery?: ActionDeliveryWriter,
    private readonly deliveryLifetimeMs = 900000,
  ) {}
  async request(
    email: string,
    purpose: Action['purpose'],
    hash: string,
    now: number,
    message: MailMessage,
  ): Promise<MailOutcome | null> {
    const expiresAt = now + (purpose === 'verification' ? 86400000 : 900000);
    const prepared = this.delivery?.prepare(
      message,
      Math.min(expiresAt, now + this.deliveryLifetimeMs),
    );
    const created = await this.tx.run(async (ctx) => {
      const identity = await this.identities.find('local:' + email, ctx);
      if (!identity) return false;
      const account = await this.accounts.lock(identity.accountId, ctx);
      if (
        !account?.enabled ||
        (purpose === 'verification' && account.emailVerified)
      )
        return false;
      const current = await this.identities.find(identity.key, ctx);
      if (!current?.active || current.cleanupPending) return false;
      await this.identities.addAction(
        {
          hash,
          accountId: identity.accountId,
          purpose,
          credentialVersion: current.credentialVersion,
          expiresAt: now + (purpose === 'verification' ? 86400000 : 900000),
          consumedAt: null,
        },
        ctx,
      );
      if (prepared && this.delivery) await this.delivery.stage(prepared, ctx);
      return true;
    });
    if (created && prepared) return null; // Durable staging succeeded; no provider acceptance is claimed.
    // Exactly one attempt after commit; unknown SMTP acceptance never regenerates a credential.
    if (!created) return null;
    try {
      return await this.mail.submit(message);
    } catch {
      return { status: 'unknown', code: 'MAIL_SUBMISSION_UNKNOWN' };
    }
  }
  async confirm(
    hash: string,
    purpose: Action['purpose'],
    now: number,
    password: string,
  ): Promise<void> {
    // Hash once outside the retryable transaction. Email proof establishes the
    // holder's chosen credential; it never activates a pending signup password.
    const passwordHash = await this.passwords.hash(password);
    const accepted = await this.tx.run(async (ctx) => {
      const action = await this.identities.consumeAction(
        hash,
        purpose,
        now,
        ctx,
      );
      if (!action) return false;
      const account = await this.accounts.lock(action.accountId, ctx);
      if (
        !account?.enabled ||
        !account.email ||
        (purpose === 'verification' && account.emailVerified)
      )
        return false;
      const identity = await this.identities.find(
        'local:' + account.email,
        ctx,
      );
      if (
        !identity ||
        identity.accountId !== account.id ||
        identity.credentialVersion !== action.credentialVersion
      )
        return false;
      if (
        !(await this.identities.replacePassword(
          identity.key,
          identity.credentialVersion,
          passwordHash,
          ctx,
        ))
      )
        return false;
      if (purpose === 'verification')
        await this.accounts.verifyEmail(account.id, ctx);
      const sessions = await this.sessions.listActive(account.id, now, ctx);
      await this.sessions.revoke(
        account.id,
        sessions.map((r) => r.id),
        now,
        ctx,
      );
      await this.identities.advanceCutoff(account.id, now, ctx);
      return true;
    });
    if (!accepted) throw new ApplicationError('INVALID_ACTION', 400);
  }
}

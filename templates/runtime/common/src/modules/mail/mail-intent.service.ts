import type { TransactionContext } from '../../core/database/transaction-context.js';
import type {
  ActionDeliveryWriter,
  PreparedMailIntent,
} from '../../core/mail/action-delivery.js';
import type {
  MailMessage,
  MailOutcome,
  MailSubmitter,
} from '../../core/mail/mail-submitter.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { MailPayloadCipher } from './mail-payload-cipher.js';
import {
  boundedMailLimit,
  type MailIntentPersistence,
  type MailIntentSummary,
} from './mail-intent-types.js';
export type MailDeliveryOptions = Readonly<{
  maxAttempts: number;
  leaseMs: number;
  maxLifetimeMs: number;
}>;
export class MailIntentService implements ActionDeliveryWriter {
  private draining = false;
  constructor(
    private readonly store: MailIntentPersistence,
    private readonly cipher: MailPayloadCipher,
    private readonly sender: MailSubmitter,
    private readonly options: MailDeliveryOptions,
    private readonly now: () => number = Date.now,
  ) {
    if (
      !Number.isInteger(options.maxAttempts) ||
      options.maxAttempts < 1 ||
      options.maxAttempts > 10 ||
      !Number.isInteger(options.leaseMs) ||
      options.leaseMs < 1000 ||
      options.leaseMs > 300000 ||
      !Number.isInteger(options.maxLifetimeMs) ||
      options.maxLifetimeMs < 1000 ||
      options.maxLifetimeMs > 86400000
    )
      throw new ApplicationError('INVALID_MAIL_DELIVERY_OPTIONS', 500);
  }
  prepare(message: MailMessage, expiresAt: number): PreparedMailIntent {
    const now = this.now();
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt > now + this.options.maxLifetimeMs
    )
      throw new ApplicationError('INVALID_MAIL_EXPIRY', 400);
    return this.cipher.encrypt(message, expiresAt);
  }
  async stage(
    prepared: PreparedMailIntent,
    context: TransactionContext,
  ): Promise<void> {
    if (
      prepared.expiresAt <= this.now() ||
      prepared.expiresAt > this.now() + this.options.maxLifetimeMs
    )
      throw new ApplicationError('MAIL_INTENT_EXPIRED', 409);
    this.cipher.decrypt(prepared); // No I/O, randomness or token regeneration in a retried callback.
    await this.store.stage(prepared, context);
  }
  /** Explicit bounded invocation; serial provider I/O, no generic queue or startup scheduler. */
  async drain(limit = 20): Promise<Readonly<{ processed: number }>> {
    boundedMailLimit(limit);
    if (this.draining) throw new ApplicationError('MAIL_DRAIN_BUSY', 409);
    this.draining = true;
    let processed = 0;
    try {
      await this.store.maintain(this.now(), limit);
      for (; processed < limit; processed++) {
        const intent = await this.store.claim(
          this.now(),
          this.options.leaseMs,
          this.options.maxAttempts,
        );
        if (!intent) break;
        let outcome: MailOutcome;
        try {
          if (!intent.payload) throw new Error();
          const message = this.cipher.decrypt({
            operationId: intent.id,
            purpose: intent.purpose,
            expiresAt: intent.expiresAt,
            keyId: intent.keyId,
            payload: intent.payload,
          });
          outcome = await this.sender.submit(message);
        } catch {
          outcome = { status: 'unknown', code: 'MAIL_DISPATCH_INTERRUPTED' };
        }
        const now = this.now();
        const retryAfterMs =
          'retryAfterMs' in outcome ? outcome.retryAfterMs : undefined;
        const retryDelay =
          Number.isFinite(retryAfterMs) && retryAfterMs! >= 0
            ? Math.min(86400000, Math.ceil(retryAfterMs!))
            : Math.min(60000, 1000 * 2 ** (intent.attempts - 1));
        const status =
          outcome.status === 'captured' || outcome.status === 'accepted'
            ? 'accepted'
            : outcome.status === 'unavailable'
              ? intent.attempts >= this.options.maxAttempts
                ? 'rejected'
                : 'retry'
              : outcome.status;
        await this.store.complete(intent.id, intent.fence, now, {
          status,
          nextAttemptAt: now + retryDelay,
        });
      }
      return { processed };
    } finally {
      this.draining = false;
    }
  }
  /** Operator/provider evidence required: retry explicitly accepts possible duplicate delivery. */
  reconcile(
    operationId: string,
    expectedFence: number,
    decision: 'accepted' | 'retry' | 'rejected',
  ): Promise<boolean> {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(operationId) ||
      !Number.isSafeInteger(expectedFence) ||
      expectedFence < 1 ||
      !['accepted', 'retry', 'rejected'].includes(decision)
    )
      throw new ApplicationError('INVALID_MAIL_RECONCILIATION', 400);
    return this.store.reconcile(
      operationId,
      expectedFence,
      this.now(),
      decision,
      this.options.maxAttempts,
    );
  }
  list(limit = 20): Promise<MailIntentSummary[]> {
    return this.store.list(boundedMailLimit(limit));
  }
}

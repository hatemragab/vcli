import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { PreparedMailIntent } from '../../core/mail/action-delivery.js';
export type MailIntentStatus =
  | 'pending'
  | 'dispatching'
  | 'retry'
  | 'unknown'
  | 'accepted'
  | 'rejected'
  | 'expired';
export type MailIntent = {
  id: string;
  purpose: PreparedMailIntent['purpose'];
  expiresAt: number;
  keyId: string;
  payload: string | null;
  contentTag: string;
  status: MailIntentStatus;
  attempts: number;
  fence: number;
  leaseUntil: number;
  nextAttemptAt: number;
  updatedAt: number;
};
export type MailIntentSummary = Pick<
  MailIntent,
  'id' | 'status' | 'attempts' | 'fence' | 'expiresAt'
>;
export type MailIntentCompletion = Readonly<{
  status: 'retry' | 'unknown' | 'accepted' | 'rejected';
  nextAttemptAt: number;
}>;
/** Native owner performs guarded atomic transitions; no network I/O in these methods. */
export interface MailIntentPersistence {
  stage(
    prepared: PreparedMailIntent,
    context: TransactionContext,
  ): Promise<void>;
  claim(
    now: number,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<MailIntent | null>;
  complete(
    id: string,
    fence: number,
    now: number,
    result: MailIntentCompletion,
  ): Promise<boolean>;
  reconcile(
    id: string,
    fence: number,
    now: number,
    decision: 'accepted' | 'retry' | 'rejected',
    maxAttempts?: number,
  ): Promise<boolean>;
  maintain(now: number, limit: number): Promise<void>;
  list(limit: number): Promise<MailIntentSummary[]>;
}
export function boundedMailLimit(value: number, maximum = 100): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error('INVALID_MAIL_LIMIT');
  return value;
}

export function validatePreparedMailIntent(prepared: PreparedMailIntent): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(prepared.operationId) ||
    !['verification', 'password-reset', 'notification'].includes(
      prepared.purpose,
    ) ||
    !Number.isSafeInteger(prepared.expiresAt) ||
    prepared.expiresAt <= 0 ||
    !/^[A-Za-z0-9_-]{1,40}$/.test(prepared.keyId) ||
    typeof prepared.payload !== 'string' ||
    prepared.payload.length < 40 ||
    prepared.payload.length > 350000
  )
    throw new Error('INVALID_MAIL_INTENT');
}

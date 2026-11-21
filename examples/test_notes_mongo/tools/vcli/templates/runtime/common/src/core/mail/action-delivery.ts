import type { TransactionContext } from '../database/transaction-context.js';
import type { MailMessage } from './mail-submitter.js';
export type PreparedMailIntent = Readonly<{
  operationId: string;
  purpose: MailMessage['purpose'];
  expiresAt: number;
  keyId: string;
  /** AES-256-GCM authenticated ciphertext; never log/export, even when encrypted. */
  payload: string;
}>;
/** Prepare before retryable callbacks; stage with the action owner's same opaque context. */
export interface ActionDeliveryWriter {
  prepare(message: MailMessage, expiresAt: number): PreparedMailIntent;
  stage(
    prepared: PreparedMailIntent,
    context: TransactionContext,
  ): Promise<void>;
}

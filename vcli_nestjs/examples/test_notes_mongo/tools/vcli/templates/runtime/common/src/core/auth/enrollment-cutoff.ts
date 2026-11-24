import type { TransactionContext } from '../database/transaction-context.js';
export interface EnrollmentCutoff {
  advanceCutoff(
    accountId: string,
    cutoff: number,
    context: TransactionContext,
  ): Promise<void>;
}

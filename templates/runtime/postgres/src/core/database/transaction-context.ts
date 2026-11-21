declare const transactionBrand: unique symbol;
export type TransactionContext = Readonly<{ [transactionBrand]: true }>;
export interface Transactions {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

/** Trusted neutral observer; one terminal outcome for each whole native operation. */
export interface DatabaseObservation {
  observe<T>(
    operation: 'connect' | 'transaction' | 'close',
    work: () => Promise<T>,
  ): Promise<T>;
}

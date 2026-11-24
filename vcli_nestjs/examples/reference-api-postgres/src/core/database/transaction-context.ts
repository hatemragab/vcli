declare const transactionBrand: unique symbol;
export type TransactionContext = Readonly<{ [transactionBrand]: true }>;
export interface Transactions {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}

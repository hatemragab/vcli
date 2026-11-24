import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { ApplicationError } from '../errors/application-error.js';
import {
  databaseError,
  databaseErrorCause,
  databaseErrorCode,
} from './database-errors.js';
import type {
  Transactions,
  TransactionContext,
} from './transaction-context.js';
type PgTransaction = Parameters<
  Parameters<NodePgDatabase['transaction']>[0]
>[0];
export class PostgresDatabase implements Transactions {
  readonly driver = 'postgres' as const;
  readonly db: NodePgDatabase;
  private closing: Promise<void> | undefined;
  private readonly contexts = new WeakMap<TransactionContext, PgTransaction>();
  private constructor(private readonly pool: Pool) {
    this.db = drizzle(pool);
  }
  static async connect(
    url: string,
    requireInitialized = true,
  ): Promise<PostgresDatabase> {
    const value = new PostgresDatabase(
      new Pool({
        connectionString: url,
        max: 8,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      }),
    );
    try {
      if (requireInitialized) {
        const check = await value.db.execute(
          sql`SELECT name FROM ref_migrations WHERE name = 'identity-v1'`,
        );
        if (!check.rowCount)
          throw new ApplicationError('DATABASE_INITIALIZATION_REQUIRED', 500);
      } else await value.db.execute(sql`SELECT 1`);
      return value;
    } catch (error) {
      await value.close();
      throw error;
    }
  }
  context(context: TransactionContext): PgTransaction {
    const tx = this.contexts.get(context);
    if (!tx) throw new ApplicationError('INVALID_TRANSACTION_CONTEXT', 500);
    return tx;
  }
  async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let callbackCompleted = false;
      try {
        return await this.db.transaction(
          async (tx) => {
            const context = Object.freeze({}) as TransactionContext;
            this.contexts.set(context, tx);
            try {
              const result = await work(context);
              callbackCompleted = true;
              return result;
            } finally {
              this.contexts.delete(context);
            }
          },
          { isolationLevel: 'serializable' },
        );
      } catch (error) {
        const cause = databaseErrorCause(error);
        const code = databaseErrorCode(error) ?? databaseErrorCode(cause);
        if (
          (code === '40001' || code === '40P01' || code === '23505') &&
          attempt < 2
        )
          continue;
        if (
          callbackCompleted &&
          code !== '40001' &&
          code !== '40P01' &&
          code !== '23505'
        )
          throw new ApplicationError('COMMIT_OUTCOME_UNKNOWN', 503);
        return databaseError(cause);
      }
    }
    throw new ApplicationError('DATABASE_BUSY', 503);
  }
  close(): Promise<void> {
    return (this.closing ??= this.pool.end());
  }
}

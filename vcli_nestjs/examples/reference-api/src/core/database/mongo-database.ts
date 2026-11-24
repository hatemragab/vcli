import {
  createConnection,
  type ClientSession,
  type Connection,
} from 'mongoose';
import { ApplicationError } from '../errors/application-error.js';
import { databaseError, databaseErrorCode } from './database-errors.js';
import type {
  Transactions,
  TransactionContext,
} from './transaction-context.js';
export class MongoDatabase implements Transactions {
  readonly driver = 'mongodb' as const;
  private readonly contexts = new WeakMap<TransactionContext, ClientSession>();
  private constructor(readonly connection: Connection) {}
  static async connect(
    url: string,
    requireInitialized = true,
  ): Promise<MongoDatabase> {
    const connection = await createConnection(url, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 8,
    }).asPromise();
    try {
      const hello = await connection.db!.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid')
        throw new ApplicationError(
          'MONGODB_TRANSACTION_TOPOLOGY_REQUIRED',
          500,
        );
      if (
        requireInitialized &&
        !(await connection
          .db!.collection('ref_migrations')
          .findOne({ name: 'identity-v1', completed: true }))
      )
        throw new ApplicationError('DATABASE_INITIALIZATION_REQUIRED', 500);
      return new MongoDatabase(connection);
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
  context(context: TransactionContext): ClientSession {
    const session = this.contexts.get(context);
    if (!session)
      throw new ApplicationError('INVALID_TRANSACTION_CONTEXT', 500);
    return session;
  }
  async run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      // Driver 7.8 uses its native 120-second retry-admission window per call.
      // timeoutMS is deprecated/no-op there; this is not a 15-second wall-clock bound.
      // Our outer loop separately permits at most three duplicate-race attempts.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await session.withTransaction(
            async () => {
              const context = Object.freeze({}) as TransactionContext;
              this.contexts.set(context, session);
              try {
                return await work(context);
              } finally {
                this.contexts.delete(context);
              }
            },
            { maxCommitTimeMS: 10000 },
          );
        } catch (error) {
          if (databaseErrorCode(error) === 11000 && attempt < 2) continue;
          return databaseError(error);
        }
      }
      throw new ApplicationError('DATABASE_BUSY', 503);
    } finally {
      await session.endSession();
    }
  }
  async close(): Promise<void> {
    await this.connection.close();
  }
}

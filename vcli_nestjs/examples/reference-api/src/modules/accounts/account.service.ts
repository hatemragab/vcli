import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { accountSchema, type Account } from './account.entity.js';

@Injectable()
export class AccountService extends BaseRepository<Account> {
  constructor(database: MongoDatabase) {
    super(database, 'ReferenceAccount', accountSchema, 'IDENTITY_EXISTS');
  }
  /** A write on this account serializes authority transitions across all participants. */
  async lock(id: string, context: TransactionContext): Promise<Account | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id },
        { $inc: { revision: 1 } },
        { session: this.database.context(context), returnDocument: 'after' },
      )
      .select({
        id: 1,
        email: 1,
        emailVerified: 1,
        enabled: 1,
        createdAt: 1,
        _id: 0,
      })
      .lean<Account>()
      .exec();
  }
  async verifyEmail(id: string, context: TransactionContext): Promise<void> {
    await this.findByIdAndUpdate(
      id,
      { $set: { emailVerified: true } },
      { context },
    );
  }
  async current(actor: Principal) {
    const account = await this.findById(actor.accountId);
    if (!account?.enabled) throw new ApplicationError('UNAUTHENTICATED', 401);
    return {
      id: account.id,
      email: account.email,
      emailVerified: account.emailVerified,
      createdAt: account.createdAt,
    };
  }
}

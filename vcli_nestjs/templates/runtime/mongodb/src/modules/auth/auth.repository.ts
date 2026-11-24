import { databaseError } from '../../core/database/database-errors.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import {
  authAccountModel,
  type AuthAccount,
  type AuthAccountDocument,
} from './auth.entity.js';

export class AuthRepository {
  private readonly accounts;

  constructor(database: MongoDatabase) {
    this.accounts = authAccountModel(database.connection);
  }

  async create(account: AuthAccount): Promise<void> {
    const { id, identifier, passwordHash, createdAt } = account;
    try {
      await this.accounts.create({
        _id: id,
        identifier,
        passwordHash,
        createdAt,
      });
    } catch (error) {
      databaseError(error);
    }
  }

  findByIdentifier(identifier: string): Promise<AuthAccount | null> {
    return this.find({ identifier });
  }

  findById(id: string): Promise<AuthAccount | null> {
    return this.find({ _id: id });
  }

  private async find(
    filter:
      | Pick<AuthAccountDocument, 'identifier'>
      | Pick<AuthAccountDocument, '_id'>,
  ): Promise<AuthAccount | null> {
    try {
      const row = await this.accounts.findOne(filter).lean().exec();
      if (!row) return null;
      const { _id, identifier, passwordHash, createdAt } = row;
      return { id: _id, identifier, passwordHash, createdAt };
    } catch (error) {
      return databaseError(error);
    }
  }
}

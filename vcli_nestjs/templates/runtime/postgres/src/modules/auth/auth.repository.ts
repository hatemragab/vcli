import { eq, type SQL } from 'drizzle-orm';
import {
  databaseError,
  databaseErrorCause,
} from '../../core/database/database-errors.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import { authAccountsTable, type AuthAccount } from './auth.entity.js';

export class AuthRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async create(account: AuthAccount): Promise<void> {
    try {
      await this.database.db.insert(authAccountsTable).values(account);
    } catch (error) {
      databaseError(databaseErrorCause(error));
    }
  }

  findByIdentifier(identifier: string): Promise<AuthAccount | null> {
    return this.find(eq(authAccountsTable.identifier, identifier));
  }

  findById(id: string): Promise<AuthAccount | null> {
    return this.find(eq(authAccountsTable.id, id));
  }

  private async find(where: SQL): Promise<AuthAccount | null> {
    try {
      const [row] = await this.database.db
        .select()
        .from(authAccountsTable)
        .where(where)
        .limit(1);
      return row ?? null;
    } catch (error) {
      return databaseError(databaseErrorCause(error));
    }
  }
}

import { getTableColumns } from 'drizzle-orm';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { accountTable, type Account } from './account.entity.js';
@Injectable()
export class AccountService extends BaseRepository<Account> {
  constructor(database: PostgresDatabase) {
    super(database, {
      table: accountTable,
      columns: { ...getTableColumns(accountTable) },
      conflictTargets: [['id']],
    });
  }
  /** Serialize authority transitions across all account participants. */
  async lock(id: string, context: TransactionContext): Promise<Account | null> {
    const db = this.database;
    const rows = await db
      .context(context)
      .execute(sql`SELECT id FROM ref_accounts WHERE id=${id} FOR UPDATE`);
    return rows.rowCount ? this.findById(id, { context }) : null;
  }
  async verifyEmail(id: string, context: TransactionContext): Promise<void> {
    await this.findByIdAndUpdate(id, { emailVerified: true }, { context });
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

  /** Identity-subsystem tombstone; this deliberately does not cascade business data. */
  async disable(
    id: string,
    eraseIdentityMetadata: boolean,
    context: TransactionContext,
  ): Promise<void> {
    await this.database
      .context(context)
      .execute(
        sql`UPDATE ref_accounts SET enabled=false,email=CASE WHEN ${eraseIdentityMetadata} THEN NULL ELSE email END,email_verified=CASE WHEN ${eraseIdentityMetadata} THEN false ELSE email_verified END WHERE id=${id}`,
      );
  }
}

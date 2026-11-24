import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { getTableColumns } from 'drizzle-orm';
import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import { installationTable, type Installation } from './installation.entity.js';

@Injectable()
export class InstallationService extends BaseRepository<Installation> {
  constructor(database: PostgresDatabase) {
    super(database, {
      table: installationTable,
      columns: { ...getTableColumns(installationTable) },
      conflictTargets: [['id']],
    });
  }

  async enroll(
    id: string,
    accountId: string,
    capabilityHash: string,
    platform: Installation['platform'],
    now: number,
    allowRebind: boolean,
    ctx: TransactionContext,
  ): Promise<Installation> {
    const db = this.database.context(ctx);
    const found = await db.execute<{ id: string }>(
      sql`SELECT id FROM ref_installations WHERE capability_hash=${capabilityHash} FOR UPDATE`,
    );
    if (!found.rows[0])
      return this.create(
        {
          id,
          accountId,
          capabilityHash,
          generation: 1,
          platform,
          createdAt: now,
        },
        { context: ctx },
      );
    const row = await this.findById(found.rows[0].id, { context: ctx });
    if (!row) throw new ApplicationError('INSTALLATION_CONFLICT', 409);
    if (row.accountId === accountId) return row;
    if (!allowRebind)
      throw new ApplicationError(
        'INSTALLATION_SWITCH_CONFIRMATION_REQUIRED',
        409,
      );
    if (row.generation >= 2147483647)
      throw new ApplicationError('INSTALLATION_GENERATION_EXHAUSTED', 409);
    await db.execute(
      sql`UPDATE ref_installations SET account_id=${accountId},generation=generation+1,platform=${platform} WHERE id=${row.id} AND generation=${row.generation}`,
    );
    return { ...row, accountId, generation: row.generation + 1, platform };
  }

  async rotateCapability(
    id: string,
    accountId: string,
    oldHash: string,
    newHash: string,
    ctx: TransactionContext,
  ): Promise<number> {
    const result = await this.database
      .context(ctx)
      .execute<{ generation: number }>(
        sql`UPDATE ref_installations SET capability_hash=${newHash},generation=generation+1 WHERE id=${id} AND account_id=${accountId} AND capability_hash=${oldHash} AND generation<2147483647 RETURNING generation`,
      );
    if (!result.rows[0])
      throw new ApplicationError('INSTALLATION_PROOF_REQUIRED', 401);
    return result.rows[0].generation;
  }
}

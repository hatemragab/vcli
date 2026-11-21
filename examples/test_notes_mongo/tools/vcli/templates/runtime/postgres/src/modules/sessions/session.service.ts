import { getTableColumns } from 'drizzle-orm';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { sessionTable } from './session.entity.js';
import type { Session, Refresh } from './session.entity.js';
import { BaseRepository } from '../../core/database/base-repository.js';
@Injectable()
export class SessionService extends BaseRepository<Session> {
  constructor(database: PostgresDatabase) {
    super(database, {
      table: sessionTable,
      columns: { ...getTableColumns(sessionTable) },
      conflictTargets: [['id']],
    });
  }
  findBySecret(
    hash: string,
    context: TransactionContext,
  ): Promise<Session | null> {
    return this.findOne(eq(sessionTable.secretHash, hash), { context });
  }
  async listActive(
    accountId: string,
    now: number,
    ctx: TransactionContext,
  ): Promise<Session[]> {
    const db = this.database;
    const projection = sql`json_build_object('id',id,'accountId',account_id,'installationId',installation_id,'installationGeneration',installation_generation,'enrollmentGeneration',enrollment_generation,'kind',kind,'identityKey',identity_key,'method',method,'secretHash',secret_hash,'authenticatedAt',authenticated_at,'createdAt',created_at,'expiresAt',expires_at,'revokedAt',revoked_at)`;
    const r = await db.context(ctx).execute<{
      data: Session;
    }>(sql`SELECT ${projection} AS data FROM ref_sessions WHERE account_id=${accountId} AND revoked_at IS NULL AND expires_at>${now} ORDER BY created_at DESC,id DESC LIMIT 101`);
    return r.rows.map((v) => v.data);
  }
  async revoke(
    accountId: string,
    ids: readonly string[],
    now: number,
    ctx: TransactionContext,
  ): Promise<void> {
    const db = this.database;
    if (!ids.length) return;
    await db.context(ctx).execute(
      sql`UPDATE ref_sessions SET revoked_at=${now} WHERE account_id=${accountId} AND id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )}) AND revoked_at IS NULL`,
    );
  }
  async addRefresh(row: Refresh, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    await db
      .context(ctx)
      .execute(
        sql`INSERT INTO ref_refresh(hash,session_id,expires_at,consumed_at) VALUES (${row.hash},${row.sessionId},${row.expiresAt},${row.consumedAt})`,
      );
  }
  async findRefresh(
    hash: string,
    ctx: TransactionContext,
  ): Promise<Refresh | null> {
    const db = this.database;
    const r = await db.context(ctx).execute<{
      data: Refresh;
    }>(sql`SELECT json_build_object('hash',hash,'sessionId',session_id,'expiresAt',expires_at,'consumedAt',consumed_at) AS data FROM ref_refresh WHERE hash=${hash}`);
    return r.rows[0]?.data ?? null;
  }
  async consumeRefresh(
    hash: string,
    now: number,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const db = this.database;
    const r = await db
      .context(ctx)
      .execute(
        sql`UPDATE ref_refresh SET consumed_at=${now} WHERE hash=${hash} AND consumed_at IS NULL AND expires_at>${now}`,
      );
    return r.rowCount === 1;
  }

  async revokeInstallation(
    id: string,
    generation: number,
    now: number,
    ctx: TransactionContext,
  ): Promise<void> {
    await this.database
      .context(ctx)
      .execute(
        sql`UPDATE ref_sessions SET revoked_at=${now} WHERE installation_id=${id} AND installation_generation<>${generation} AND revoked_at IS NULL`,
      );
  }
  async revokeIdentity(
    key: string,
    now: number,
    ctx: TransactionContext,
    method?: string,
  ): Promise<void> {
    await this.database
      .context(ctx)
      .execute(
        sql`UPDATE ref_sessions SET revoked_at=${now} WHERE identity_key=${key} AND revoked_at IS NULL ${method ? sql`AND method=${method}` : sql``}`,
      );
  }
  async revokeAll(
    accountId: string,
    now: number,
    ctx: TransactionContext,
  ): Promise<void> {
    await this.database
      .context(ctx)
      .execute(
        sql`UPDATE ref_sessions SET revoked_at=${now} WHERE account_id=${accountId} AND revoked_at IS NULL`,
      );
  }
}

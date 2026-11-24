import { ApplicationError } from '../../core/errors/application-error.js';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { Identity } from './identity.entity.js';
// vcli:begin email-actions
import type { Action } from './identity.entity.js';
// vcli:end email-actions
const identityProjection = sql`json_build_object('key',key,'accountId',account_id,'passwordHash',password_hash,'credentialVersion',credential_version,'enrollmentCutoff',enrollment_cutoff,'generation',generation,'active',active,'methods',methods,'cleanupPending',cleanup_pending)`;
@Injectable()
export class IdentityService {
  constructor(private readonly database: PostgresDatabase) {}
  async find(key: string, ctx: TransactionContext): Promise<Identity | null> {
    const db = this.database;
    const r = await db.context(ctx).execute<{
      data: Identity;
    }>(sql`SELECT ${identityProjection} AS data FROM identities WHERE key=${key}`);
    return r.rows[0]?.data ?? null;
  }
  async lock(key: string, ctx: TransactionContext): Promise<Identity | null> {
    const db = this.database;
    const r = await db.context(ctx).execute<{
      data: Identity;
    }>(sql`SELECT ${identityProjection} AS data FROM identities WHERE key=${key} FOR UPDATE`);
    return r.rows[0]?.data ?? null;
  }
  async create(row: Identity, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    await db
      .context(ctx)
      .execute(
        sql`INSERT INTO identities(key,account_id,password_hash,credential_version,enrollment_cutoff,generation,active,methods,cleanup_pending) VALUES (${row.key},${row.accountId},${row.passwordHash},${row.credentialVersion},${row.enrollmentCutoff},${row.generation},${row.active},${JSON.stringify(row.methods)}::jsonb,${row.cleanupPending})`,
      );
  }
  async replacePassword(
    key: string,
    version: number,
    hash: string,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const db = this.database;
    const r = await db
      .context(ctx)
      .execute(
        sql`UPDATE identities SET password_hash=${hash},credential_version=credential_version+1 WHERE key=${key} AND credential_version=${version} AND active=true AND cleanup_pending=false`,
      );
    return r.rowCount === 1;
  }
  async advanceCutoff(
    accountId: string,
    cutoff: number,
    ctx: TransactionContext,
  ): Promise<void> {
    const db = this.database;
    await db
      .context(ctx)
      .execute(
        sql`UPDATE identities SET enrollment_cutoff=GREATEST(enrollment_cutoff,${cutoff}) WHERE account_id=${accountId}`,
      );
  }
  // vcli:begin email-actions
  async addAction(row: Action, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    await db
      .context(ctx)
      .execute(
        sql`INSERT INTO actions(hash,account_id,purpose,credential_version,expires_at,consumed_at) VALUES (${row.hash},${row.accountId},${row.purpose},${row.credentialVersion},${row.expiresAt},${row.consumedAt})`,
      );
  }
  async consumeAction(
    hash: string,
    purpose: Action['purpose'],
    now: number,
    ctx: TransactionContext,
  ): Promise<Action | null> {
    const db = this.database;
    const r = await db.context(ctx).execute<{
      data: Action;
    }>(sql`UPDATE actions SET consumed_at=${now} WHERE hash=${hash} AND purpose=${purpose} AND expires_at>${now} AND consumed_at IS NULL RETURNING json_build_object('hash',hash,'accountId',account_id,'purpose',purpose,'credentialVersion',credential_version,'expiresAt',expires_at,'consumedAt',consumed_at) AS data`);
    return r.rows[0]?.data ?? null;
  }
  // vcli:end email-actions
  async list(accountId: string, ctx: TransactionContext): Promise<Identity[]> {
    const rows = await this.database
      .context(ctx)
      .execute<{ data: Identity }>(
        sql`SELECT ${identityProjection} AS data FROM identities WHERE account_id=${accountId} ORDER BY key LIMIT 33`,
      );
    return rows.rows.map((row) => row.data);
  }
  async updateLifecycle(
    key: string,
    generation: number,
    patch: Pick<Identity, 'active' | 'cleanupPending' | 'methods'>,
    ctx: TransactionContext,
    advance = false,
  ): Promise<Identity> {
    const result = await this.database
      .context(ctx)
      .execute<{ data: Identity }>(
        sql`UPDATE identities SET active=${patch.active},cleanup_pending=${patch.cleanupPending},methods=${JSON.stringify(patch.methods)}::jsonb,generation=generation+${advance ? 1 : 0},password_hash=CASE WHEN ${patch.active} THEN password_hash ELSE NULL END,credential_version=credential_version+${patch.active ? 0 : 1} WHERE key=${key} AND generation=${generation} RETURNING ${identityProjection} AS data`,
      );
    const row = result.rows[0]?.data;
    if (!row) throw new ApplicationError('IDENTITY_CONFLICT', 409);
    return row;
  }
}

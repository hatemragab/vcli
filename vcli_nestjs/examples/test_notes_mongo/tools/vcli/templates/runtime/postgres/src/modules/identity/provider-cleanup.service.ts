import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { ProviderCleanup } from './provider-cleanup.entity.js';
import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
const projection = sql`json_build_object('id',id,'identityKey',identity_key,'generation',generation,'action',action,'method',method,'status',status,'attempts',attempts,'nextAttemptAt',next_attempt_at,'leaseId',lease_id,'leaseUntil',lease_until,'lastCode',last_code,'createdAt',created_at,'completedAt',completed_at)`;
@Injectable()
export class ProviderCleanupService {
  constructor(private readonly database: PostgresDatabase) {}
  async stage(row: ProviderCleanup, ctx: TransactionContext): Promise<void> {
    await this.database
      .context(ctx)
      .execute(
        sql`INSERT INTO ref_provider_cleanup(id,identity_key,generation,action,method,status,attempts,next_attempt_at,lease_id,lease_until,last_code,created_at,completed_at) VALUES (${row.id},${row.identityKey},${row.generation},${row.action},${row.method},${row.status},${row.attempts},${row.nextAttemptAt},${row.leaseId},${row.leaseUntil},${row.lastCode},${row.createdAt},${row.completedAt})`,
      );
  }
  async claim(
    now: number,
    leaseId: string,
    ctx: TransactionContext,
  ): Promise<ProviderCleanup | null> {
    const db = this.database.context(ctx);
    // An abandoned unlink cannot safely replay against a freshly linked provider. Keep its fence.
    await db.execute(
      sql`UPDATE ref_provider_cleanup SET status='unknown',last_code='PROVIDER_UNKNOWN' WHERE id=(SELECT id FROM ref_provider_cleanup WHERE status='leased' AND action='unlink' AND lease_until<=${now} ORDER BY lease_until,id LIMIT 1 FOR UPDATE SKIP LOCKED)`,
    );
    const result = await db.execute<{ data: ProviderCleanup }>(
      sql`UPDATE ref_provider_cleanup SET status='leased',lease_id=${leaseId},lease_until=${now + 30000},attempts=attempts+1 WHERE id=(SELECT id FROM ref_provider_cleanup WHERE attempts<8 AND next_attempt_at<=${now} AND (status IN ('pending','retry') OR (action<>'unlink' AND (status='unknown' OR (status='leased' AND lease_until<=${now})))) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING ${projection} AS data`,
    );
    return result.rows[0]?.data ?? null;
  }
  async settle(
    row: ProviderCleanup,
    status: ProviderCleanup['status'],
    code: ProviderCleanup['lastCode'],
    now: number,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const result = await this.database
      .context(ctx)
      .execute(
        sql`UPDATE ref_provider_cleanup SET status=${status},last_code=${code},next_attempt_at=${now + Math.min(3600000, 1000 * 2 ** row.attempts)},completed_at=${status === 'completed' ? now : null},lease_until=0 WHERE id=${row.id} AND status='leased' AND lease_id=${row.leaseId}`,
      );
    return result.rowCount === 1;
  }
}

import { createHash } from 'node:crypto';
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  lt,
  lte,
  sql,
} from 'drizzle-orm';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { PreparedMailIntent } from '../../core/mail/action-delivery.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { mailIntentTable as table } from './mail-intent.entity.js';
import {
  boundedMailLimit,
  validatePreparedMailIntent,
  type MailIntent,
  type MailIntentCompletion,
  type MailIntentPersistence,
  type MailIntentSummary,
} from './mail-intent-types.js';
export class MailIntentStore
  extends BaseRepository<MailIntent>
  implements MailIntentPersistence
{
  constructor(database: PostgresDatabase) {
    super(database, {
      table,
      columns: getTableColumns(table),
      conflictTargets: [['id']],
    });
  }
  async stage(
    prepared: PreparedMailIntent,
    context: TransactionContext,
  ): Promise<void> {
    validatePreparedMailIntent(prepared);
    const tx = this.database.context(context),
      tag = createHash('sha256').update(prepared.payload).digest('hex');
    await tx
      .insert(table)
      .values({
        id: prepared.operationId,
        purpose: prepared.purpose,
        expiresAt: prepared.expiresAt,
        keyId: prepared.keyId,
        payload: prepared.payload,
        contentTag: tag,
        status: 'pending',
        attempts: 0,
        fence: 0,
        leaseUntil: 0,
        nextAttemptAt: 0,
        updatedAt: Date.now(),
      })
      .onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(table)
      .where(eq(table.id, prepared.operationId));
    if (
      !row ||
      row.contentTag !== tag ||
      row.expiresAt !== prepared.expiresAt ||
      row.purpose !== prepared.purpose ||
      row.keyId !== prepared.keyId
    )
      throw new ApplicationError('MAIL_OPERATION_CONFLICT', 409);
  }
  claim(
    now: number,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<MailIntent | null> {
    return this.database.run(async (context) => {
      const tx = this.database.context(context);
      const [row] = await tx
        .select()
        .from(table)
        .where(
          and(
            inArray(table.status, ['pending', 'retry']),
            lte(table.nextAttemptAt, now),
            gt(table.expiresAt, now),
            lt(table.attempts, maxAttempts),
          ),
        )
        .orderBy(asc(table.nextAttemptAt), asc(table.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx
        .update(table)
        .set({
          status: 'dispatching',
          leaseUntil: now + leaseMs,
          updatedAt: now,
          fence: row.fence + 1,
          attempts: row.attempts + 1,
        })
        .where(eq(table.id, row.id))
        .returning();
      return claimed ?? null;
    });
  }
  async complete(
    id: string,
    fence: number,
    now: number,
    result: MailIntentCompletion,
  ): Promise<boolean> {
    const rows = await this.database.db
      .update(table)
      .set({
        status: result.status,
        nextAttemptAt: result.nextAttemptAt,
        leaseUntil: 0,
        updatedAt: now,
        ...(['accepted', 'rejected'].includes(result.status)
          ? { payload: null }
          : {}),
      })
      .where(
        and(
          eq(table.id, id),
          eq(table.fence, fence),
          eq(table.status, 'dispatching'),
          gt(table.leaseUntil, now),
          gt(table.expiresAt, now),
        ),
      )
      .returning({ id: table.id });
    return rows.length === 1;
  }
  async reconcile(
    id: string,
    fence: number,
    now: number,
    decision: 'accepted' | 'retry' | 'rejected',
    maxAttempts = 10,
  ): Promise<boolean> {
    const rows = await this.database.db
      .update(table)
      .set({
        status: decision,
        nextAttemptAt: now,
        updatedAt: now,
        fence: sql`${table.fence} + 1`,
        ...(decision !== 'retry' ? { payload: null } : {}),
      })
      .where(
        and(
          eq(table.id, id),
          eq(table.fence, fence),
          eq(table.status, 'unknown'),
          gt(table.expiresAt, now),
          decision === 'retry' ? lt(table.attempts, maxAttempts) : undefined,
        ),
      )
      .returning({ id: table.id });
    return rows.length === 1;
  }
  async maintain(now: number, limit: number): Promise<void> {
    boundedMailLimit(limit);
    await this.database.run(async (context) => {
      const tx = this.database.context(context);
      const rows = await tx
        .select()
        .from(table)
        .where(
          sql`(${table.expiresAt} <= ${now} AND ${table.payload} IS NOT NULL)
        OR (${table.status} = 'dispatching' AND ${table.leaseUntil} <= ${now})
        OR (${table.status} IN ('accepted','rejected','expired') AND ${table.updatedAt} <= ${now - 86400000})`,
        )
        .limit(limit)
        .for('update', { skipLocked: true });
      for (const row of rows) {
        if (
          ['accepted', 'rejected', 'expired'].includes(row.status) &&
          row.updatedAt <= now - 86400000
        )
          await tx.delete(table).where(eq(table.id, row.id));
        else
          await tx
            .update(table)
            .set({
              status: row.expiresAt <= now ? 'expired' : 'unknown',
              ...(row.expiresAt <= now ? { payload: null } : {}),
              leaseUntil: 0,
              updatedAt: now,
              fence: row.fence + 1,
            })
            .where(eq(table.id, row.id));
      }
    });
  }
  list(limit: number): Promise<MailIntentSummary[]> {
    return this.database.db
      .select({
        id: table.id,
        status: table.status,
        attempts: table.attempts,
        fence: table.fence,
        expiresAt: table.expiresAt,
      })
      .from(table)
      .orderBy(asc(table.id))
      .limit(boundedMailLimit(limit));
  }
}

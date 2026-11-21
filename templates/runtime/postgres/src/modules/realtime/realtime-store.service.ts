import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type {
  AdmissionTicket,
  RealtimeBinding,
  RealtimeStore,
  TicketPurpose,
} from '../../core/realtime/realtime-store.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { bindingSchema, principalSchema } from './realtime-records.js';
@Injectable()
export class RealtimeStoreService implements RealtimeStore {
  constructor(private readonly database: PostgresDatabase) {}
  async assertInitialized(): Promise<void> {
    const result = await this.database.db.execute(
      sql`SELECT name FROM ref_migrations WHERE name='realtime-v1'`,
    );
    if (result.rowCount !== 1)
      throw new ApplicationError('REALTIME_INITIALIZATION_REQUIRED', 503);
  }
  async issue(ticket: AdmissionTicket, now: number): Promise<void> {
    await this.database.run(async (context) => {
      const tx = this.database.context(context);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(79044322)`);
      await tx.execute(
        sql`DELETE FROM vcli_realtime_records WHERE expires_at<=${now}`,
      );
      const counts = await tx.execute(sql`SELECT
        count(*) FILTER(WHERE kind='ticket')::integer AS total,
        count(*) FILTER(WHERE kind='ticket' AND session_id=${ticket.principal.sessionId})::integer AS session,
        count(*) FILTER(WHERE kind='rate')::integer AS rates FROM vcli_realtime_records`);
      const rateId = 'rate:' + ticket.principal.sessionId;
      const rate = await tx.execute(
        sql`SELECT count FROM vcli_realtime_records WHERE id=${rateId}`,
      );
      const count = Number(rate.rows[0]?.count ?? 0),
        row = counts.rows[0]!;
      if (
        Number(row.total) >= 512 ||
        Number(row.session) >= 4 ||
        count >= 10 ||
        (!count && Number(row.rates) >= 512)
      )
        throw new ApplicationError('REALTIME_LIMIT', 429);
      await tx.execute(sql`INSERT INTO vcli_realtime_records(id,kind,session_id,purpose,expires_at,data)
        VALUES(${ticket.hash},'ticket',${ticket.principal.sessionId},${ticket.purpose},${ticket.expiresAt},${JSON.stringify(ticket.principal)}::jsonb)`);
      await tx.execute(sql`INSERT INTO vcli_realtime_records(id,kind,session_id,expires_at,count)
        VALUES(${rateId},'rate',${ticket.principal.sessionId},${now + 60000},1)
        ON CONFLICT(id) DO UPDATE SET count=vcli_realtime_records.count+1`);
    });
  }
  async consume(
    hash: string,
    purpose: TicketPurpose,
    now: number,
  ): Promise<Principal | null> {
    // One native DELETE RETURNING: exactly one node gets the principal, including replay races.
    const result = await this.database.db
      .execute(sql`DELETE FROM vcli_realtime_records
      WHERE id=${hash} AND kind='ticket' AND purpose=${purpose} AND expires_at>${now} RETURNING data`);
    return result.rows[0] ? principalSchema.parse(result.rows[0].data) : null;
  }
  async addBinding(binding: RealtimeBinding, now: number): Promise<void> {
    bindingSchema.parse(binding);
    await this.database.run(async (context) => {
      const tx = this.database.context(context);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(79044322)`);
      await tx.execute(
        sql`DELETE FROM vcli_realtime_records WHERE kind='binding' AND expires_at<=${now}`,
      );
      const counts = await tx.execute(sql`SELECT count(*)::integer AS total,
        count(*) FILTER(WHERE session_id=${binding.principal.sessionId})::integer AS session
        FROM vcli_realtime_records WHERE kind='binding'`);
      if (
        Number(counts.rows[0]!.total) >= 128 ||
        Number(counts.rows[0]!.session) >= 8
      )
        throw new ApplicationError('REALTIME_LIMIT', 429);
      await tx.execute(sql`INSERT INTO vcli_realtime_records(id,kind,session_id,account_id,expires_at,data)
        VALUES(${'binding:' + binding.client},'binding',${binding.principal.sessionId},${binding.principal.accountId},${binding.expiresAt},${JSON.stringify(binding)}::jsonb)`);
    });
  }
  async binding(client: string): Promise<RealtimeBinding | null> {
    const result = await this.database.db.execute(
      sql`SELECT data FROM vcli_realtime_records WHERE id=${'binding:' + client} AND kind='binding'`,
    );
    return result.rows[0] ? bindingSchema.parse(result.rows[0].data) : null;
  }
  async bindings(accountId?: string): Promise<readonly RealtimeBinding[]> {
    const result = await this.database.db.execute(
      accountId === undefined
        ? sql`SELECT data FROM vcli_realtime_records WHERE kind='binding' LIMIT 129`
        : sql`SELECT data FROM vcli_realtime_records WHERE kind='binding' AND account_id=${accountId} LIMIT 129`,
    );
    if (result.rows.length > 128)
      throw new ApplicationError('REALTIME_LIMIT', 503);
    return result.rows.map((row) => bindingSchema.parse(row.data));
  }
  async touchBinding(
    binding: RealtimeBinding,
    expiresAt: number,
  ): Promise<boolean> {
    const next = { ...binding, expiresAt };
    const result = await this.database.db
      .execute(sql`UPDATE vcli_realtime_records SET expires_at=${expiresAt},data=${JSON.stringify(next)}::jsonb
      WHERE id=${'binding:' + binding.client} AND data=${JSON.stringify(binding)}::jsonb AND expires_at>${Date.now()} RETURNING id`);
    return result.rowCount === 1;
  }
  async removeBinding(binding: RealtimeBinding): Promise<boolean> {
    const result = await this.database.db.execute(
      sql`DELETE FROM vcli_realtime_records WHERE id=${'binding:' + binding.client} AND data=${JSON.stringify(binding)}::jsonb`,
    );
    return result.rowCount === 1;
  }
  async heartbeat(nodeId: string, expiresAt: number): Promise<void> {
    await this.database.run(async (context) => {
      const tx = this.database.context(context);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(79044322)`);
      await tx.execute(
        sql`DELETE FROM vcli_realtime_records WHERE kind='node' AND expires_at<=${Date.now()}`,
      );
      const count = await tx.execute(
        sql`SELECT count(*)::integer AS count FROM vcli_realtime_records WHERE kind='node' AND id<>${'node:' + nodeId}`,
      );
      if (Number(count.rows[0]?.count) >= 16)
        throw new ApplicationError('REALTIME_NODE_LIMIT', 503);
      await tx.execute(sql`INSERT INTO vcli_realtime_records(id,kind,expires_at) VALUES(${'node:' + nodeId},'node',${expiresAt})
        ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at`);
    });
  }
  async nodes(now: number): Promise<readonly string[]> {
    const result = await this.database.db.execute(
      sql`SELECT id FROM vcli_realtime_records WHERE kind='node' AND expires_at>${now} LIMIT 17`,
    );
    if (result.rows.length > 16)
      throw new ApplicationError('REALTIME_NODE_LIMIT', 503);
    return result.rows.map((row) => String(row.id).slice(5));
  }
  async removeNode(nodeId: string): Promise<void> {
    await this.database.db.execute(
      sql`DELETE FROM vcli_realtime_records WHERE id=${'node:' + nodeId} AND kind='node'`,
    );
  }
}

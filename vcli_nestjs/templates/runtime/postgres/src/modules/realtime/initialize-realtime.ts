import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
/** Explicit release contribution only; ordinary bootstrap never performs DDL. */
export async function initializeRealtime(
  database: PostgresDatabase,
): Promise<void> {
  await database.run(async (context) => {
    const tx = database.context(context);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(79044322)`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS vcli_realtime_records (
      id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('ticket','rate','binding','node')),
      session_id text, account_id text, purpose text, expires_at bigint NOT NULL,
      count integer, data jsonb)`);
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS vcli_realtime_expiry ON vcli_realtime_records(kind,expires_at)`,
    );
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS vcli_realtime_session ON vcli_realtime_records(kind,session_id)`,
    );
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS vcli_realtime_account ON vcli_realtime_records(kind,account_id)`,
    );
    await tx.execute(
      sql`INSERT INTO migrations(name) VALUES ('realtime-v1') ON CONFLICT DO NOTHING`,
    );
  });
  // Selected adapter schema contribution.
}

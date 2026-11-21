import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { emptyPushState, type PushState } from './push.entity.js';
import type { PushStateStore } from './push-state-store.js';
import { decodePushState } from './push-storage-mapping.js';

export class PostgresPushStateStore implements PushStateStore {
  private readonly database;
  private closing: Promise<void> | undefined;
  private constructor(private readonly pool: Pool) {
    this.database = drizzle(pool);
  }

  static async connect(
    url: string,
    initialize = false,
  ): Promise<PostgresPushStateStore> {
    const store = new PostgresPushStateStore(
      new Pool({
        connectionString: url,
        max: 3,
        connectionTimeoutMillis: 5000,
        statement_timeout: 5000,
      }),
    );
    try {
      if (initialize)
        await store.database.transaction(async (transaction) => {
          await transaction.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext('reference-push-schema-v1'))`,
          );
          await transaction.execute(
            sql`CREATE TABLE IF NOT EXISTS reference_push_state (id text PRIMARY KEY, state jsonb NOT NULL)`,
          );
        });
      else
        await store.database.execute(
          sql`SELECT id FROM reference_push_state LIMIT 0`,
        );
      return store;
    } catch (error: unknown) {
      await store.close();
      throw error;
    }
  }

  async read(): Promise<PushState> {
    const result = await this.database.execute<{ state: unknown }>(
      sql`SELECT state FROM reference_push_state WHERE id = 'destinations'`,
    );
    return result.rows[0]
      ? decodePushState(result.rows[0].state)
      : emptyPushState();
  }

  async change(update: (state: PushState) => PushState): Promise<PushState> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`INSERT INTO reference_push_state (id, state) VALUES ('destinations', ${JSON.stringify(emptyPushState())}::jsonb) ON CONFLICT (id) DO NOTHING`,
      );
      const result = await transaction.execute<{ state: unknown }>(
        sql`SELECT state FROM reference_push_state WHERE id = 'destinations' FOR UPDATE`,
      );
      const next = update(decodePushState(result.rows[0]?.state));
      await transaction.execute(
        sql`UPDATE reference_push_state SET state = ${JSON.stringify(next)}::jsonb WHERE id = 'destinations'`,
      );
      return next;
    });
  }

  close(): Promise<void> {
    return (this.closing ??= this.pool.end());
  }
}

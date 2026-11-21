import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { emptyMediaState, type MediaOwnerState } from './media.entity.js';
import type { MediaStateStore } from './media-state-store.js';
import { decodeMediaState } from './media-storage-mapping.js';

export class PostgresMediaStateStore implements MediaStateStore {
  private readonly database;
  private closing: Promise<void> | undefined;
  private constructor(private readonly pool: Pool) {
    this.database = drizzle(pool);
  }

  static async connect(
    url: string,
    initialize = false,
  ): Promise<PostgresMediaStateStore> {
    const store = new PostgresMediaStateStore(
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
            sql`SELECT pg_advisory_xact_lock(hashtext('reference-media-schema-v1'))`,
          );
          await transaction.execute(
            sql`CREATE TABLE IF NOT EXISTS reference_media_owners (owner_id text PRIMARY KEY, state jsonb NOT NULL)`,
          );
        });
      else
        await store.database.execute(
          sql`SELECT owner_id FROM reference_media_owners LIMIT 0`,
        );
      return store;
    } catch (error: unknown) {
      await store.close();
      throw error;
    }
  }

  async read(ownerId: string): Promise<MediaOwnerState> {
    const result = await this.database.execute<{ state: unknown }>(
      sql`SELECT state FROM reference_media_owners WHERE owner_id = ${ownerId}`,
    );
    return result.rows[0]
      ? decodeMediaState(result.rows[0].state, ownerId)
      : emptyMediaState();
  }

  async change(
    ownerId: string,
    update: (state: MediaOwnerState) => MediaOwnerState,
  ): Promise<MediaOwnerState> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`INSERT INTO reference_media_owners (owner_id, state) VALUES (${ownerId}, ${JSON.stringify(emptyMediaState())}::jsonb) ON CONFLICT (owner_id) DO NOTHING`,
      );
      const result = await transaction.execute<{ state: unknown }>(
        sql`SELECT state FROM reference_media_owners WHERE owner_id = ${ownerId} FOR UPDATE`,
      );
      const next = update(decodeMediaState(result.rows[0]?.state, ownerId));
      await transaction.execute(
        sql`UPDATE reference_media_owners SET state = ${JSON.stringify(next)}::jsonb WHERE owner_id = ${ownerId}`,
      );
      return next;
    });
  }

  close(): Promise<void> {
    return (this.closing ??= this.pool.end());
  }
}

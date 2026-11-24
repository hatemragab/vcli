import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../core/database/postgres-database.js';
import type {
  QuiescedReleaseDecision,
  ReleaseLedger,
  ReleaseSession,
  ReleaseStore,
} from './release-types.js';
import {
  assertQuiescedDecision,
  decodeReleaseLedger,
  emptyReleaseLedger,
} from './release-validation.js';

// A session lock on its own connection, distinct from identity's xact lock 61921233.
const lockKey = 61921234;
export class NativeReleaseStore implements ReleaseStore {
  private client: PoolClient | undefined;
  private constructor(private readonly pool: Pool) {}
  static async connect(url: string): Promise<NativeReleaseStore> {
    const store = new NativeReleaseStore(
      new Pool({
        connectionString: url,
        max: 1,
        connectionTimeoutMillis: 5000,
        statement_timeout: 10000,
      }),
    );
    try {
      await store.pool.query('SELECT 1');
      return store;
    } catch {
      await store.close();
      throw new Error('RELEASE_DATABASE_UNAVAILABLE');
    }
  }
  async acquire(recovery?: QuiescedReleaseDecision): Promise<ReleaseSession> {
    if (recovery) assertQuiescedDecision(recovery);
    if (this.client) throw new Error('RELEASE_BUSY');
    const client = await this.pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [lockKey],
      );
      if (!lock.rows[0]?.locked) throw new Error('RELEASE_BUSY');
      await client.query(
        'CREATE TABLE IF NOT EXISTS vcli_release_history (id integer PRIMARY KEY CHECK (id=1), data jsonb NOT NULL)',
      );
      await client.query(
        'INSERT INTO vcli_release_history(id,data) VALUES (1,$1::jsonb) ON CONFLICT DO NOTHING',
        [JSON.stringify(emptyReleaseLedger())],
      );
      const result = await client.query<{ data: unknown }>(
        'SELECT data FROM vcli_release_history WHERE id=1',
      );
      const ledger = decodeReleaseLedger(result.rows[0]?.data);
      if (recovery) {
        if (
          ledger.holder !== recovery.expectedHolder ||
          ledger.fence !== recovery.expectedFence
        )
          throw new Error('STALE_RELEASE_RECOVERY');
      } else if (ledger.holder !== null)
        throw new Error('RELEASE_RECONCILIATION_REQUIRED');
      ledger.fence++;
      ledger.holder = randomUUID();
      await client.query(
        'UPDATE vcli_release_history SET data=$1::jsonb WHERE id=1',
        [JSON.stringify(ledger)],
      );
      this.client = client;
      return { token: ledger.holder, fence: ledger.fence };
    } catch (error) {
      await client
        .query('SELECT pg_advisory_unlock($1)', [lockKey])
        .catch(() => undefined);
      client.release();
      throw error;
    }
  }
  async read(): Promise<ReleaseLedger | null> {
    const connection = this.client ?? this.pool;
    const exists = await connection.query<{ name: string | null }>(
      "SELECT to_regclass('vcli_release_history')::text AS name",
    );
    if (!exists.rows[0]?.name) return null;
    const result = await connection.query<{ data: unknown }>(
      'SELECT data FROM vcli_release_history WHERE id=1',
    );
    return result.rows[0] ? decodeReleaseLedger(result.rows[0].data) : null;
  }
  async change(
    session: ReleaseSession,
    update: (ledger: ReleaseLedger) => void,
  ): Promise<void> {
    if (!this.client) throw new Error('RELEASE_FENCE_LOST');
    const ledger = await this.read();
    if (
      !ledger ||
      ledger.holder !== session.token ||
      ledger.fence !== session.fence
    )
      throw new Error('RELEASE_FENCE_LOST');
    update(ledger);
    decodeReleaseLedger(ledger);
    const result = await this.client.query(
      "UPDATE vcli_release_history SET data=$1::jsonb WHERE id=1 AND data->>'holder'=$2 AND (data->>'fence')::bigint=$3",
      [JSON.stringify(ledger), session.token, session.fence],
    );
    if (result.rowCount !== 1) throw new Error('RELEASE_FENCE_LOST');
  }
  async release(session: ReleaseSession): Promise<void> {
    const client = this.client;
    if (!client) throw new Error('RELEASE_FENCE_LOST');
    try {
      await this.change(session, (ledger) => {
        ledger.holder = null;
      });
    } finally {
      this.client = undefined;
      await client
        .query('SELECT pg_advisory_unlock($1)', [lockKey])
        .catch(() => undefined);
      client.release();
    }
  }
  async close(): Promise<void> {
    // An interrupted session retains its durable holder; a reconnect cannot call it success.
    if (this.client) {
      this.client.release(true);
      this.client = undefined;
    }
    await this.pool.end();
  }
}
/** Read-only boot assertion input; does not create a table, acquire a lock or run owners. */
export async function readNativeReleaseLedger(
  database: PostgresDatabase,
): Promise<ReleaseLedger | null> {
  const exists = await database.db.execute<{ name: string | null }>(
    sql`SELECT to_regclass('vcli_release_history')::text AS name`,
  );
  if (!exists.rows[0]?.name) return null;
  const result = await database.db.execute<{ data: unknown }>(
    sql`SELECT data FROM vcli_release_history WHERE id=1`,
  );
  return result.rows[0] ? decodeReleaseLedger(result.rows[0].data) : null;
}

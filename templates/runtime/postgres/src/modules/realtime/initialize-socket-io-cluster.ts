import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
/** Selected official adapter schema, called only by explicit cluster initialization. */
export async function initializeSocketIoCluster(
  database: PostgresDatabase,
): Promise<void> {
  await database.db
    .execute(sql`CREATE TABLE IF NOT EXISTS vcli_socket_io_attachments (
    id bigserial UNIQUE, created_at timestamptz DEFAULT now(), payload bytea)`);
}

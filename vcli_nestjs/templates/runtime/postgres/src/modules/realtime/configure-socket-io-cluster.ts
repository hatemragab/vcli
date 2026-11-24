import { sql } from 'drizzle-orm';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/postgres-adapter';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
/** Selected native pool, externally composed and closed by the application owner. */
export async function configureSocketIoCluster(
  io: Server,
  database: PostgresDatabase,
): Promise<void> {
  try {
    await database.db.execute(
      sql`SELECT id FROM vcli_socket_io_attachments LIMIT 0`,
    );
  } catch {
    throw new ApplicationError('REALTIME_CLUSTER_INITIALIZATION_REQUIRED', 503);
  }
  io.adapter(
    createAdapter(database.pool, {
      channelPrefix: 'vcli.socket.io',
      tableName: 'vcli_socket_io_attachments',
      payloadThreshold: 7000,
      cleanupInterval: 10000,
      heartbeatInterval: 1000,
      heartbeatTimeout: 5000,
    }),
  );
}

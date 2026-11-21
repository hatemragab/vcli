import { ApplicationError } from '../../core/errors/application-error.js';
import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
/** Uses the initialized capped collection on the explicitly supplied native handle. */
export async function configureSocketIoCluster(
  io: Server,
  database: MongoDatabase,
): Promise<void> {
  const collection = database.connection.db!.collection(
    'vcli_socket_io_events',
  );
  const options = await collection.options().catch(() => null);
  if (
    !options ||
    options.capped !== true ||
    Number(options.size) !== 4 * 1024 * 1024
  )
    throw new ApplicationError('REALTIME_CLUSTER_INITIALIZATION_REQUIRED', 503);
  io.adapter(
    createAdapter(database.connection.db!.collection('vcli_socket_io_events'), {
      requestsTimeout: 4000,
      heartbeatInterval: 1000,
      heartbeatTimeout: 5000,
    }),
  );
}

import type { MongoDatabase } from '../../core/database/mongo-database.js';
/** Selected official adapter schema; bootstrap never creates this collection. */
export async function initializeSocketIoCluster(
  database: MongoDatabase,
): Promise<void> {
  const db = database.connection.db!,
    name = 'vcli_socket_io_events';
  if (!(await db.listCollections({ name }).hasNext()))
    await db.createCollection(name, { capped: true, size: 4 * 1024 * 1024 });
  const options = await db.collection(name).options();
  if (options.capped !== true || Number(options.size) !== 4 * 1024 * 1024)
    throw new Error('REALTIME_ADAPTER_COLLECTION_CONFLICT');
}

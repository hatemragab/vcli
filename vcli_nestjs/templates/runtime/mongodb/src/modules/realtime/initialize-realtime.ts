import type { RealtimeRow } from './realtime-records.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
/** Explicit release contribution only; never call at ordinary startup. */
export async function initializeRealtime(
  database: MongoDatabase,
): Promise<void> {
  const db = database.connection.db!;
  if (!(await db.listCollections({ name: 'vcli_realtime_records' }).hasNext()))
    await db.createCollection('vcli_realtime_records');
  const records = db.collection<RealtimeRow>('vcli_realtime_records');
  await records.createIndex({ kind: 1, expiresAt: 1 });
  await records.createIndex({ kind: 1, sessionId: 1 });
  await records.createIndex({ kind: 1, accountId: 1 });
  await records.updateOne(
    { _id: 'lock' },
    {
      $setOnInsert: {
        kind: 'lock',
        expiresAt: Number.MAX_SAFE_INTEGER,
        count: 0,
      },
    },
    { upsert: true },
  );
  // Selected adapter schema contribution.
  await db
    .collection('ref_migrations')
    .updateOne(
      { name: 'realtime-v1' },
      { $set: { completed: true } },
      { upsert: true },
    );
}

import type { MongoDatabase } from '../../core/database/mongo-database.js';
/** Explicit owner migration; caller supplies release locking/history. */
export async function migrateInstallationLifecycle(
  database: MongoDatabase,
): Promise<void> {
  const collection = database.connection.db!.collection('ref_installations');
  await collection.updateMany(
    { capabilityHash: { $exists: false } },
    { $set: { capabilityHash: null } },
  );
  await collection.createIndex(
    { capabilityHash: 1 },
    {
      unique: true,
      partialFilterExpression: { capabilityHash: { $type: 'string' } },
    },
  );
}

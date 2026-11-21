import type { MongoDatabase } from '../../core/database/mongo-database.js';
/** Old hash/profile material deliberately requires reauthentication after this explicit release. */
export async function migrateSessionLifecycle(
  database: MongoDatabase,
): Promise<void> {
  await database.connection.db!.collection('ref_sessions').updateMany(
    { installationGeneration: { $exists: false } },
    {
      $set: {
        installationGeneration: 1,
        enrollmentGeneration: 1,
        revokedAt: Date.now(),
      },
    },
  );
}

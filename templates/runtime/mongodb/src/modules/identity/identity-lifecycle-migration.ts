import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { providerCleanupSchema } from './provider-cleanup.entity.js';
/** Explicit release-only contribution; root controls migration locking/history. */
export async function migrateIdentityLifecycle(
  database: MongoDatabase,
): Promise<void> {
  const db = database.connection.db!;
  await db.collection('ref_identities').updateMany(
    { generation: { $exists: false } },
    {
      $set: {
        generation: 1,
        active: true,
        methods: ['password', 'phone', 'google.com', 'apple.com'],
        cleanupPending: false,
      },
    },
  );
  const cleanup = database.connection.model(
    'AppProviderCleanup',
    providerCleanupSchema,
  );
  await cleanup.createCollection();
  await cleanup.createIndexes();
}

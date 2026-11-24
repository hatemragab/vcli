import type { MongoDatabase } from '../../core/database/mongo-database.js';
// vcli:begin provider-cleanup
import { providerCleanupSchema } from './provider-cleanup.entity.js';
// vcli:end provider-cleanup
/** Explicit release-only contribution; root controls migration locking/history. */
export async function migrateIdentityLifecycle(
  database: MongoDatabase,
): Promise<void> {
  const db = database.connection.db!;
  await db.collection('identities').updateMany(
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
  // vcli:begin provider-cleanup
  const cleanup = database.connection.model(
    'AppProviderCleanup',
    providerCleanupSchema,
  );
  await cleanup.createCollection();
  await cleanup.createIndexes();
  // vcli:end provider-cleanup
}

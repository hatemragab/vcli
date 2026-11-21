import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { mailIntentSchema } from './mail-intent.entity.js';
/** Explicit release/schema command only. Never call at ordinary application startup. */
export async function initializeMail(database: MongoDatabase): Promise<void> {
  const model = database.connection.model('MailIntent', mailIntentSchema);
  await model.createCollection();
  await model.createIndexes();
}

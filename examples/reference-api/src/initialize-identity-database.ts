import type { AppConfig } from './core/config/app-config.js';
import { openDatabase } from './core/database/database.js';
import { ApplicationError } from './core/errors/application-error.js';
import { accountSchema } from './modules/accounts/account.entity.js';
import { installationSchema } from './modules/installations/installation.entity.js';
import {
  identitySchema,
  actionSchema,
  rateSchema,
} from './modules/identity/identity.entity.js';
import {
  sessionSchema,
  refreshSchema,
} from './modules/sessions/session.entity.js';
export async function initializeIdentityDatabase(
  config: AppConfig,
): Promise<void> {
  const db = await openDatabase(config, false);
  try {
    const migrations = db.connection.db!.collection('ref_migrations');
    if (await migrations.findOne({ name: 'identity-v1', completed: true }))
      return;
    await migrations.createIndex({ name: 1 }, { unique: true });
    try {
      await migrations.insertOne({ name: 'identity-v1', completed: false });
    } catch {
      throw new ApplicationError('MIGRATION_LOCKED_OR_INCOMPLETE', 500);
    }
    // A failed release retains its lock: inspect/reconcile before an operator retries.
    const models = [
      db.connection.model('ReferenceAccount', accountSchema),
      db.connection.model('ReferenceIdentity', identitySchema),
      db.connection.model('ReferenceAction', actionSchema),
      db.connection.model('ReferenceIdentityRate', rateSchema),
      db.connection.model('ReferenceInstallation', installationSchema),
      db.connection.model('ReferenceSession', sessionSchema),
      db.connection.model('ReferenceRefresh', refreshSchema),
    ];
    for (const model of models) {
      await model.createCollection();
      await model.createIndexes();
    }
    await migrations.updateOne(
      { name: 'identity-v1', completed: false },
      { $set: { completed: true } },
    );
  } finally {
    await db.close();
  }
}

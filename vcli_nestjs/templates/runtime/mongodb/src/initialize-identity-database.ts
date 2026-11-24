import type { AppConfig } from './core/config/app-config.js';
import { openDatabase } from './core/database/database.js';
import { ApplicationError } from './core/errors/application-error.js';
import { accountSchema } from './modules/accounts/account.entity.js';
import { installationSchema } from './modules/installations/installation.entity.js';
// vcli:begin email-actions
import { actionSchema } from './modules/identity/identity.entity.js';
// vcli:end email-actions
import { identitySchema } from './modules/identity/identity.entity.js';
import {
  sessionSchema,
  refreshSchema,
} from './modules/sessions/session.entity.js';
import { migrateIdentityLifecycle } from './modules/identity/identity-lifecycle-migration.js';
import { migrateInstallationLifecycle } from './modules/installations/installation-lifecycle-migration.js';
import { migrateSessionLifecycle } from './modules/sessions/session-lifecycle-migration.js';

/** Explicit release command only; failed/incomplete owner locks require operator reconciliation. */
export async function initializeIdentityDatabase(
  config: AppConfig,
): Promise<void> {
  const db = await openDatabase(config, false);
  try {
    const migrations = db.connection.db!.collection('migrations');
    await migrations.createIndex({ name: 1 }, { unique: true });
    const claim = async (name: string): Promise<boolean> => {
      if (await migrations.findOne({ name, completed: true })) return false;
      try {
        await migrations.insertOne({ name, completed: false });
      } catch {
        throw new ApplicationError('MIGRATION_LOCKED_OR_INCOMPLETE', 500);
      }
      return true;
    };
    if (await claim('identity-v1')) {
      const models = [
        db.connection.model('AppAccount', accountSchema),
        db.connection.model('AppIdentity', identitySchema),
        // vcli:begin email-actions
        db.connection.model('AppAction', actionSchema),
        // vcli:end email-actions
        db.connection.model('AppInstallation', installationSchema),
        db.connection.model('AppSession', sessionSchema),
        db.connection.model('AppRefresh', refreshSchema),
      ];
      for (const model of models) {
        await model.createCollection();
        await model.createIndexes();
      }
      await migrations.updateOne(
        { name: 'identity-v1', completed: false },
        { $set: { completed: true } },
      );
    }
    if (await claim('identity-lifecycle-v2')) {
      await migrateIdentityLifecycle(db);
      await migrateInstallationLifecycle(db);
      await migrateSessionLifecycle(db);
      await migrations.updateOne(
        { name: 'identity-lifecycle-v2', completed: false },
        { $set: { completed: true } },
      );
    }
  } finally {
    await db.close();
  }
}

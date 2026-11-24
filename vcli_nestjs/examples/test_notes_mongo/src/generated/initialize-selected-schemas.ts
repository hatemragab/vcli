import type { AppConfig } from '../core/config/app-config.js';
import { NativeReleaseStore } from '../release/native-release-store.js';
import { ReleaseCoordinator } from '../release/release-coordinator.js';
import { customMigrations } from '../release/custom-migrations.js';
import { openDatabase } from '../core/database/database.js';
import { selectedReleaseManifest } from './selected-release.js';
import { initializeIdentityDatabase } from '../initialize-identity-database.js';
import { initializeMediaSchema } from '../modules/media/media.module.js';
import { initializeNotes } from '../modules/notes/initialize-notes.js';
export async function initializeSelectedSchemas(
  config: AppConfig,
): Promise<readonly string[]> {
  const store = await NativeReleaseStore.connect(config.database.url);
  try {
    return await new ReleaseCoordinator(store).apply(selectedReleaseManifest, [
      {
        component: 'identity',
        apply: () => initializeIdentityDatabase(config),
      },

      { component: 'media', apply: () => initializeMediaSchema(config) },

      {
        component: 'notes',
        apply: async () => {
          const database = await openDatabase(config, false);
          try {
            await initializeNotes(database);
          } finally {
            await database.close();
          }
        },
      },

      ...customMigrations.map(({ component, apply }) => ({
        component,
        apply: async () => {
          const database = await openDatabase(config, false);
          try {
            await apply(database);
          } finally {
            await database.close();
          }
        },
      })),
    ]);
  } finally {
    await store.close();
  }
}

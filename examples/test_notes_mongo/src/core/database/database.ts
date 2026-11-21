import type { DatabaseObservation } from './transaction-context.js';
import type { AppConfig } from '../config/app-config.js';
import { MongoDatabase } from './mongo-database.js';
/** This application was initialized for MongoDB; there is no runtime database selection. */
export function openDatabase(
  config: AppConfig,
  requireInitialized = true,
  observation?: DatabaseObservation,
): Promise<MongoDatabase> {
  return MongoDatabase.connect(
    config.database.url,
    requireInitialized,
    observation,
  );
}

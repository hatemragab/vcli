import type { DatabaseObservation } from './transaction-context.js';
import type { AppConfig } from '../config/app-config.js';
import { PostgresDatabase } from './postgres-database.js';

/** This application's database was selected at initialization. */
export function openDatabase(
  config: AppConfig,
  requireInitialized = true,
  observation?: DatabaseObservation,
): Promise<PostgresDatabase> {
  return PostgresDatabase.connect(
    config.database.url,
    requireInitialized,
    observation,
  );
}

import type { AppConfig } from '../config/app-config.js';
import { PostgresDatabase } from './postgres-database.js';

/** This application's database was selected at initialization. */
export function openDatabase(
  config: AppConfig,
  initialized = true,
): Promise<PostgresDatabase> {
  return PostgresDatabase.connect(config.database.url, initialized);
}

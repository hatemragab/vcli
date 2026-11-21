import type { AppConfig } from '../config/app-config.js';
import { MongoDatabase } from './mongo-database.js';
/** This application was initialized for MongoDB; there is no runtime database selection. */
export function openDatabase(
  config: AppConfig,
  initialized = true,
): Promise<MongoDatabase> {
  return MongoDatabase.connect(config.database.url, initialized);
}

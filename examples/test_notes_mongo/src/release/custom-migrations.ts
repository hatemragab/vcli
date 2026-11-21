import type { MongoDatabase } from '../core/database/mongo-database.js';
import type { ReleaseComponent } from './release-types.js';

export type CustomMigration = ReleaseComponent &
  Readonly<{
    component: `app.${string}`;
    apply(database: MongoDatabase): Promise<void>;
  }>;

/**
 * Register one entry per schema owner in dependency order. Use a stable app.* name,
 * a positive version and a SHA-256 digest of the reviewed migration steps.
 * Each new version must migrate both fresh and previously supported schemas.
 * The runner owns the database connection. See ops/release/README.md.
 */
export const customMigrations: readonly CustomMigration[] = [];

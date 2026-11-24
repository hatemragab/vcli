import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { AppConfig } from './core/config/app-config.js';
import { openDatabase } from './core/database/database.js';
export async function initializeIdentityDatabase(
  config: AppConfig,
): Promise<void> {
  const db = await openDatabase(config, false);
  try {
    const migration = await readFile(
      new URL('../migrations/001-identity.sql', import.meta.url),
      'utf8',
    );
    await db.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(61921233)`);
      await tx.execute(
        sql`CREATE TABLE IF NOT EXISTS ref_migrations(name text PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT now())`,
      );
      const existing = await tx.execute(
        sql`SELECT name FROM ref_migrations WHERE name='identity-v1'`,
      );
      if (existing.rowCount) return;
      await tx.execute(sql.raw(migration));
      await tx.execute(
        sql`INSERT INTO ref_migrations(name) VALUES ('identity-v1')`,
      );
    });
  } finally {
    await db.close();
  }
}

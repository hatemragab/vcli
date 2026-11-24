import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { AppConfig } from './core/config/app-config.js';
import { openDatabase } from './core/database/database.js';

/** Explicit release command only; ordinary open validates markers without running DDL. */
export async function initializeIdentityDatabase(
  config: AppConfig,
): Promise<void> {
  const db = await openDatabase(config, false);
  try {
    const migrations = await Promise.all([
      readFile(
        new URL('../migrations/001-identity.sql', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../migrations/002-identity-lifecycle.sql', import.meta.url),
        'utf8',
      ),
    ]);
    await db.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(61921233)`);
      await tx.execute(
        sql`CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT now())`,
      );
      for (const [index, name] of [
        'identity-v1',
        'identity-lifecycle-v2',
      ].entries()) {
        const existing = await tx.execute(
          sql`SELECT name FROM migrations WHERE name=${name}`,
        );
        if (existing.rowCount) continue;
        await tx.execute(sql.raw(migrations[index]!));
        await tx.execute(
          sql`INSERT INTO migrations(name) VALUES (${name})`,
        );
      }
    });
  } finally {
    await db.close();
  }
}

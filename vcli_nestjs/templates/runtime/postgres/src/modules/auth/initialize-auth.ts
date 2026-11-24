import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import { authAccountsTable, authIdentifierIndex } from './auth.entity.js';

/** Apply the basic account schema during the selected release. */
export async function initializeAuth(
  database: PostgresDatabase,
): Promise<void> {
  await database.run(async (context) => {
    const tx = database.context(context);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS ${authAccountsTable} (
      id uuid PRIMARY KEY,
      identifier varchar(254) NOT NULL CHECK (length(identifier) > 0),
      password_hash text NOT NULL CHECK (length(password_hash) > 0),
      created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991)
    )`);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ${sql.identifier(authIdentifierIndex)}
      ON ${authAccountsTable} (identifier)
    `);
  });
}

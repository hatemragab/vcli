import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import { ApplicationError } from '../../core/errors/application-error.js';
/** Explicit owner schema release; no startup DDL and no unrelated reference table adoption. */
export async function initializeNotes(
  database: PostgresDatabase,
): Promise<void> {
  await database.run(async (context) => {
    const tx = database.context(context);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('vcli-app-notes-v1'))`,
    );
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS app_notes (
      id uuid PRIMARY KEY CHECK (substring(id::text,15,1)='4'),owner_id uuid NOT NULL,
      title varchar(120) NOT NULL CHECK (length(btrim(title))>0 AND title=btrim(title)),
      body text NOT NULL CHECK (length(body)<=10000),
      created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991))`);
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS app_notes_owner_created ON app_notes(owner_id,created_at DESC,id DESC)`,
    );
  });
}
export async function assertNotesInitialized(
  database: PostgresDatabase,
): Promise<void> {
  try {
    await database.db.execute(
      sql`SELECT id,owner_id,title,body,created_at FROM app_notes LIMIT 0`,
    );
  } catch {
    throw new ApplicationError('NOTES_SCHEMA_NOT_INITIALIZED', 503);
  }
}

import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';

/** Apply after the baseline Notes release; existing notes retain their text. */
export async function initializeNotesImage(
  database: PostgresDatabase,
): Promise<void> {
  await database.run(async (context) => {
    await database
      .context(context)
      .execute(
        sql`ALTER TABLE app_notes ADD COLUMN IF NOT EXISTS image_id uuid`,
      );
  });
}

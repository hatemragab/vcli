import { sql } from 'drizzle-orm';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
/** Explicit release/schema command only. No application-startup production migrations. */
export async function initializeMail(
  database: PostgresDatabase,
): Promise<void> {
  await database.run(async (context) => {
    const tx = database.context(context);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS vcli_mail_intents (
      id text PRIMARY KEY, purpose text NOT NULL CHECK (purpose IN ('verification','password-reset','notification')),
      expires_at bigint NOT NULL, key_id text NOT NULL, payload text, content_tag text NOT NULL,
      status text NOT NULL CHECK (status IN ('pending','dispatching','retry','unknown','accepted','rejected','expired')),
      attempts integer NOT NULL CHECK (attempts BETWEEN 0 AND 10), fence integer NOT NULL CHECK (fence >= 0),
      lease_until bigint NOT NULL, next_attempt_at bigint NOT NULL, updated_at bigint NOT NULL)`);
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS vcli_mail_intents_due ON vcli_mail_intents(status,next_attempt_at,expires_at)`,
    );
    await tx.execute(
      sql`CREATE INDEX IF NOT EXISTS vcli_mail_intents_expiry ON vcli_mail_intents(expires_at)`,
    );
  });
}

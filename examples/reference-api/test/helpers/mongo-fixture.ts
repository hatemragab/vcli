import type { TestContext } from 'node:test';
import { loadConfig } from '../../dist/core/config/load-config.js';
import { openDatabase } from '../../dist/core/database/database.js';

/** Test-only fixture. The coordinator prepares all owner schemas using scripts/migrate.ts. */
export async function openTestDatabase(t: Pick<TestContext, 'after'>) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL_REQUIRED');
  const database = await openDatabase(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: url }),
  );
  t.after(() => database.close());
  return database;
}

import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../../dist/core/config/load-config.js';
import { openDatabase } from '../../dist/core/database/database.js';
import { initializeIdentityDatabase } from '../../dist/initialize-identity-database.js';
import { initializeCapabilitySchemas } from '../../dist/modules/media/media.module.js';
import { NotesService } from '../../dist/modules/notes/notes.service.js';

/** Missing infrastructure is an explicit skip; a supplied but broken URL fails. */
export const databaseTest = process.env.TEST_DATABASE_URL ? test : test.skip;
export const configDatabaseUrl =
  'postgresql://unused.invalid/reference_test_config';
export type TestCleanup = { after(work: () => Promise<void>): void };

/** A dedicated TEST_DATABASE_URL with CREATE SCHEMA privilege is required. Never uses DATABASE_URL. */
export async function postgresFixture(cleanup?: TestCleanup) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL_REQUIRED');
  const admin = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  // Generated identifiers contain only a fixed prefix and hex; no user identifiers enter SQL.
  try {
    await admin.query(`CREATE SCHEMA "${name}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const selected = new URL(url);
  const currentOptions = selected.searchParams.get('options') ?? '';
  selected.searchParams.set(
    'options',
    `${currentOptions} -c search_path=${name}`.trim(),
  );
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: selected.toString(),
  });
  let database: Awaited<ReturnType<typeof openDatabase>> | undefined;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await database?.close();
    } finally {
      try {
        await admin.query(`DROP SCHEMA "${name}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  };
  try {
    await initializeIdentityDatabase(config);
    await initializeCapabilitySchemas(config);
    database = await openDatabase(config);
    await new NotesService(database, {
      async publish() {
        return { status: 'audience-ineligible', transport: 'socketio' };
      },
    }).initializeSchema();
    cleanup?.after(close);
    return { database, config, url: selected.toString(), close, sql };
  } catch (error) {
    await close();
    throw error;
  }
}

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PostgresDatabase } from '../core/database/postgres-database.js';
import type { ReleaseManifest } from './release-types.js';
import type { NativeBackupOperations } from './backup-types.js';
import { readNativeReleaseLedger } from './native-release-store.js';
import { assertLedgerReady } from './release-validation.js';
import { writePrivateFile } from './private-files.js';
import {
  runNativeCommand,
  type NativeCommandRunner,
} from './native-command.js';
import { nativeDatabaseUrl } from './native-database-url.js';

export class NativeBackup implements NativeBackupOperations {
  constructor(
    private readonly runner: NativeCommandRunner = runNativeCommand,
  ) {}
  describe(url: string): { name: string; identity: string } {
    const { name, identity } = nativeDatabaseUrl(url);
    return { name, identity };
  }
  async assertReady(url: string, manifest: ReleaseManifest): Promise<void> {
    nativeDatabaseUrl(url);
    const database = await PostgresDatabase.connect(url, false);
    try {
      assertLedgerReady(await readNativeReleaseLedger(database), manifest);
    } finally {
      await database.close();
    }
  }
  private async execute(
    url: string,
    work: string,
    executable: string,
    args: readonly string[],
  ): Promise<void> {
    const config = nativeDatabaseUrl(url),
      file = join(work, 'pgpass-' + randomUUID());
    const escape = (value: string) =>
      value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
    await writePrivateFile(
      file,
      [config.host, config.port, config.name, config.user, config.password]
        .map(escape)
        .join(':') + '\n',
    );
    try {
      await this.runner({
        executable,
        args,
        env: {
          PGHOST: config.host,
          PGPORT: config.port,
          PGDATABASE: config.name,
          PGUSER: config.user,
          PGSSLMODE: config.sslmode,
          PGPASSFILE: file,
          PGCONNECT_TIMEOUT: '5',
        },
        timeoutMs: 300000,
      });
    } finally {
      await rm(file, { force: true });
    }
  }
  dump(url: string, file: string, work: string): Promise<void> {
    return this.execute(url, work, 'pg_dump', [
      '--format=custom',
      '--no-password',
      '--file',
      file,
    ]);
  }
  restore(
    url: string,
    file: string,
    sourceName: string,
    work: string,
  ): Promise<void> {
    if (nativeDatabaseUrl(url).name === sourceName)
      throw new Error('UNSAFE_RESTORE_DATABASE');
    // No --create or --clean: all SQL targets the explicit empty isolated database.
    return this.execute(url, work, 'pg_restore', [
      '--no-password',
      '--dbname',
      nativeDatabaseUrl(url).name,
      '--single-transaction',
      '--exit-on-error',
      '--no-owner',
      '--no-privileges',
      file,
    ]);
  }
  async reserveEmptyTarget(
    url: string,
    sourceName: string,
    _resourceId: string,
  ): Promise<() => Promise<void>> {
    const target = nativeDatabaseUrl(url);
    if (target.name === sourceName) throw new Error('UNSAFE_RESTORE_DATABASE');
    const pool = new Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    const client = await pool.connect();
    try {
      const lock = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(61921235) AS locked',
      );
      if (!lock.rows[0]?.locked) throw new Error('RESTORE_TARGET_BUSY');
      const existing = await client.query(
        "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' LIMIT 1",
      );
      if (existing.rowCount) throw new Error('RESTORE_TARGET_NOT_EMPTY');
      await client.query(
        'CREATE TABLE vcli_restore_guard (id integer PRIMARY KEY CHECK(id=1), created_at timestamptz NOT NULL DEFAULT now())',
      );
      await client.query('INSERT INTO vcli_restore_guard(id) VALUES (1)');
      return async () => {
        try {
          await client.query('SELECT pg_advisory_unlock(61921235)');
        } finally {
          client.release();
          await pool.end();
        }
      };
    } catch (error) {
      client.release(true);
      await pool.end();
      throw error;
    }
  }
}

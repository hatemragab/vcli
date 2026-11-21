import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnection } from 'mongoose';
import { MongoDatabase } from '../core/database/mongo-database.js';
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
    const database = await MongoDatabase.connect(url, false);
    try {
      assertLedgerReady(await readNativeReleaseLedger(database), manifest);
    } finally {
      await database.close();
    }
  }
  private async execute(
    uri: string,
    work: string,
    executable: string,
    args: readonly string[],
  ): Promise<void> {
    const file = join(work, 'mongo-' + randomUUID() + '.yaml');
    // JSON string syntax is a YAML double-quoted scalar; URI/password never enters argv.
    await writePrivateFile(file, 'uri: ' + JSON.stringify(uri) + '\n');
    try {
      await this.runner({
        executable,
        args: ['--config', file, '--quiet', ...args],
        env: {},
        timeoutMs: 300000,
      });
    } finally {
      await rm(file, { force: true });
    }
  }
  dump(url: string, file: string, work: string): Promise<void> {
    nativeDatabaseUrl(url);
    return this.execute(url, work, 'mongodump', [
      '--archive=' + file,
      '--gzip',
    ]);
  }
  restore(
    url: string,
    file: string,
    sourceName: string,
    work: string,
  ): Promise<void> {
    const target = nativeDatabaseUrl(url);
    if (
      !/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(sourceName) ||
      target.name === sourceName
    )
      throw new Error('UNSAFE_RESTORE_DATABASE');
    return this.execute(target.restoreUrl, work, 'mongorestore', [
      '--archive=' + file,
      '--gzip',
      '--nsInclude=' + sourceName + '.*',
      '--nsFrom=' + sourceName + '.*',
      '--nsTo=' + target.name + '.*',
      '--stopOnError',
      '--numParallelCollections=1',
    ]);
  }
  async reserveEmptyTarget(
    url: string,
    sourceName: string,
    resourceId: string,
  ): Promise<() => Promise<void>> {
    if (nativeDatabaseUrl(url).name === sourceName)
      throw new Error('UNSAFE_RESTORE_DATABASE');
    const connection = await createConnection(url, {
      autoCreate: false,
      autoIndex: false,
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    try {
      if (await connection.db!.listCollections().hasNext())
        throw new Error('RESTORE_TARGET_NOT_EMPTY');
      // Atomic namespace creation prevents two restore runners passing the empty check.
      const guard = await connection.db!.createCollection(
        'vcli_restore_guard',
        { writeConcern: { w: 'majority' } },
      );
      await guard.insertOne(
        { resourceId, startedAt: new Date().toISOString() },
        { writeConcern: { w: 'majority' } },
      );
      return async () => {
        await connection.close();
      };
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
}

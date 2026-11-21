import { randomUUID } from 'node:crypto';
import { createConnection, type Connection } from 'mongoose';
import type { MongoDatabase } from '../core/database/mongo-database.js';
import type {
  QuiescedReleaseDecision,
  ReleaseLedger,
  ReleaseSession,
  ReleaseStore,
} from './release-types.js';
import {
  assertQuiescedDecision,
  decodeReleaseLedger,
  emptyReleaseLedger,
} from './release-validation.js';

type ReleaseDocument = { _id: string; revision: number; data: ReleaseLedger };
/** No expiring lease: time/dead-owner suspicion never authorizes another runner. */
export class NativeReleaseStore implements ReleaseStore {
  private constructor(private readonly connection: Connection) {}
  private get collection() {
    return this.connection.db!.collection<ReleaseDocument>(
      'vcli_release_history',
    );
  }
  static async connect(url: string): Promise<NativeReleaseStore> {
    const connection = await createConnection(url, {
      autoCreate: false,
      autoIndex: false,
      maxPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    try {
      const hello = await connection.db!.admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid')
        throw new Error('MONGODB_TRANSACTION_TOPOLOGY_REQUIRED');
      return new NativeReleaseStore(connection);
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
  async acquire(recovery?: QuiescedReleaseDecision): Promise<ReleaseSession> {
    if (recovery) assertQuiescedDecision(recovery);
    try {
      await this.collection.insertOne(
        { _id: 'selected', revision: 0, data: emptyReleaseLedger() },
        { writeConcern: { w: 'majority' } },
      );
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 11000
      )
        throw error;
    }
    const token = randomUUID();
    const result = await this.collection.findOneAndUpdate(
      {
        _id: 'selected',
        'data.holder': recovery ? recovery.expectedHolder : null,
        ...(recovery ? { 'data.fence': recovery.expectedFence } : {}),
      },
      {
        $inc: { revision: 1, 'data.fence': 1 },
        $set: { 'data.holder': token },
      },
      { returnDocument: 'after', writeConcern: { w: 'majority' } },
    );
    if (!result)
      throw new Error(
        recovery
          ? 'STALE_RELEASE_RECOVERY'
          : 'RELEASE_BUSY_OR_RECONCILIATION_REQUIRED',
      );
    const ledger = decodeReleaseLedger(result.data);
    return { token, fence: ledger.fence };
  }
  async read(): Promise<ReleaseLedger | null> {
    const document = await this.collection.findOne(
      { _id: 'selected' },
      { readConcern: { level: 'majority' } },
    );
    return document ? decodeReleaseLedger(document.data) : null;
  }
  async change(
    session: ReleaseSession,
    update: (ledger: ReleaseLedger) => void,
  ): Promise<void> {
    const document = await this.collection.findOne(
      {
        _id: 'selected',
        'data.holder': session.token,
        'data.fence': session.fence,
      },
      { readConcern: { level: 'majority' } },
    );
    if (!document) throw new Error('RELEASE_FENCE_LOST');
    const ledger = decodeReleaseLedger(document.data);
    update(ledger);
    decodeReleaseLedger(ledger);
    const result = await this.collection.updateOne(
      {
        _id: 'selected',
        revision: document.revision,
        'data.holder': session.token,
        'data.fence': session.fence,
      },
      { $set: { data: ledger }, $inc: { revision: 1 } },
      { writeConcern: { w: 'majority' } },
    );
    if (result.modifiedCount !== 1) throw new Error('RELEASE_FENCE_LOST');
  }
  release(session: ReleaseSession): Promise<void> {
    return this.change(session, (ledger) => {
      ledger.holder = null;
    });
  }
  async close(): Promise<void> {
    await this.connection.close();
  }
}
/** Read-only; no index/collection setup and no provider network. */
export async function readNativeReleaseLedger(
  database: MongoDatabase,
): Promise<ReleaseLedger | null> {
  const document = await database.connection
    .db!.collection<ReleaseDocument>('vcli_release_history')
    .findOne({ _id: 'selected' }, { readConcern: { level: 'majority' } });
  return document ? decodeReleaseLedger(document.data) : null;
}

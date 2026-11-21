import { Injectable } from '@nestjs/common';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { sessionSchema, refreshSchema } from './session.entity.js';
import type { Session, Refresh } from './session.entity.js';
import { BaseRepository } from '../../core/database/base-repository.js';
@Injectable()
export class SessionService extends BaseRepository<Session> {
  constructor(database: MongoDatabase) {
    super(database, 'ReferenceSession', sessionSchema, 'SESSION_EXISTS');
  }
  findBySecret(
    hash: string,
    context: TransactionContext,
  ): Promise<Session | null> {
    return this.findOne({ secretHash: hash }, { context });
  }
  async listActive(
    accountId: string,
    now: number,
    ctx: TransactionContext,
  ): Promise<Session[]> {
    const db = this.database;
    const sessions = this.model;
    return await sessions
      .find({ accountId, revokedAt: null, expiresAt: { $gt: now } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(101)
      .session(db.context(ctx))
      .select({ _id: 0, revision: 0 })
      .lean<Session[]>()
      .exec();
  }
  async revoke(
    accountId: string,
    ids: readonly string[],
    now: number,
    ctx: TransactionContext,
  ): Promise<void> {
    const db = this.database;
    const sessions = this.model;
    await sessions.updateMany(
      { accountId, _id: { $in: ids }, revokedAt: null },
      { $set: { revokedAt: now } },
      { session: db.context(ctx) },
    );
  }
  async addRefresh(row: Refresh, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    const refresh = db.connection.model('ReferenceRefresh', refreshSchema);
    await refresh.create([{ ...row, _id: row.hash }], {
      session: db.context(ctx),
    });
  }
  async findRefresh(
    hash: string,
    ctx: TransactionContext,
  ): Promise<Refresh | null> {
    const db = this.database;
    const refresh = db.connection.model('ReferenceRefresh', refreshSchema);
    return await refresh
      .findById(hash)
      .session(db.context(ctx))
      .select({ _id: 0, revision: 0 })
      .lean<Refresh>()
      .exec();
  }
  async consumeRefresh(
    hash: string,
    now: number,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const db = this.database;
    const refresh = db.connection.model('ReferenceRefresh', refreshSchema);
    const r = await refresh.updateOne(
      { _id: hash, consumedAt: null, expiresAt: { $gt: now } },
      { $set: { consumedAt: now } },
      { session: db.context(ctx) },
    );
    return r.modifiedCount === 1;
  }
}

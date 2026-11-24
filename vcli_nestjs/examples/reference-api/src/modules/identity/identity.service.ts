import { Injectable } from '@nestjs/common';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { identitySchema, actionSchema, rateSchema } from './identity.entity.js';
import type { Identity, Action } from './identity.entity.js';
@Injectable()
export class IdentityService {
  constructor(private readonly database: MongoDatabase) {}
  async find(key: string, ctx: TransactionContext): Promise<Identity | null> {
    const db = this.database;
    const identities = db.connection.model('ReferenceIdentity', identitySchema);
    return await identities
      .findById(key)
      .session(db.context(ctx))
      .select({ _id: 0, revision: 0 })
      .lean<Identity>()
      .exec();
  }
  async lock(key: string, ctx: TransactionContext): Promise<Identity | null> {
    const db = this.database;
    const identities = db.connection.model('ReferenceIdentity', identitySchema);
    return await identities
      .findOneAndUpdate(
        { _id: key },
        { $inc: { revision: 1 } },
        { session: db.context(ctx), returnDocument: 'after' },
      )
      .select({ _id: 0, revision: 0 })
      .lean<Identity>()
      .exec();
  }
  async create(row: Identity, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    const identities = db.connection.model('ReferenceIdentity', identitySchema);
    await identities.create([{ ...row, _id: row.key }], {
      session: db.context(ctx),
    });
  }
  async replacePassword(
    key: string,
    version: number,
    hash: string,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const db = this.database;
    const identities = db.connection.model('ReferenceIdentity', identitySchema);
    const r = await identities.updateOne(
      { _id: key, credentialVersion: version },
      { $set: { passwordHash: hash }, $inc: { credentialVersion: 1 } },
      { session: db.context(ctx) },
    );
    return r.modifiedCount === 1;
  }
  async advanceCutoff(
    accountId: string,
    cutoff: number,
    ctx: TransactionContext,
  ): Promise<void> {
    const db = this.database;
    const identities = db.connection.model('ReferenceIdentity', identitySchema);
    await identities.updateMany(
      { accountId },
      { $max: { enrollmentCutoff: cutoff } },
      { session: db.context(ctx) },
    );
  }
  async addAction(row: Action, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    const actions = db.connection.model('ReferenceAction', actionSchema);
    await actions.create([{ ...row, _id: row.hash }], {
      session: db.context(ctx),
    });
  }
  async consumeAction(
    hash: string,
    purpose: Action['purpose'],
    now: number,
    ctx: TransactionContext,
  ): Promise<Action | null> {
    const db = this.database;
    const actions = db.connection.model('ReferenceAction', actionSchema);
    return await actions
      .findOneAndUpdate(
        { _id: hash, purpose, expiresAt: { $gt: now }, consumedAt: null },
        { $set: { consumedAt: now } },
        { session: db.context(ctx), returnDocument: 'before' },
      )
      .select({ _id: 0, revision: 0 })
      .lean<Action>()
      .exec();
  }
  async spendRate(
    key: string,
    window: number,
    limit: number,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const db = this.database;
    const rates = db.connection.model('ReferenceIdentityRate', rateSchema);
    const current = await rates
      .findById(key)
      .session(db.context(ctx))
      .lean<{
        window: number;
        used: number;
      }>()
      .exec();
    if (current && current.window > window) return false;
    const used = current?.window === window ? current.used + 1 : 1;
    if (current)
      await rates.updateOne(
        { _id: key },
        { $set: { window, used } },
        { session: db.context(ctx) },
      );
    else
      await rates.create([{ _id: key, key, window, used }], {
        session: db.context(ctx),
      });
    return used <= limit;
  }
}

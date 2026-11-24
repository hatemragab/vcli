import { ApplicationError } from '../../core/errors/application-error.js';
import { Injectable } from '@nestjs/common';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { identitySchema } from './identity.entity.js';
// vcli:begin email-actions
import { actionSchema } from './identity.entity.js';
// vcli:end email-actions
import type { Identity } from './identity.entity.js';
// vcli:begin email-actions
import type { Action } from './identity.entity.js';
// vcli:end email-actions
@Injectable()
export class IdentityService {
  constructor(private readonly database: MongoDatabase) {}
  async find(key: string, ctx: TransactionContext): Promise<Identity | null> {
    const db = this.database;
    const identities = db.connection.model('AppIdentity', identitySchema);
    return await identities
      .findById(key)
      .session(db.context(ctx))
      .select({ _id: 0, revision: 0 })
      .lean<Identity>()
      .exec();
  }
  async lock(key: string, ctx: TransactionContext): Promise<Identity | null> {
    const db = this.database;
    const identities = db.connection.model('AppIdentity', identitySchema);
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
    const identities = db.connection.model('AppIdentity', identitySchema);
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
    const identities = db.connection.model('AppIdentity', identitySchema);
    const r = await identities.updateOne(
      {
        _id: key,
        credentialVersion: version,
        active: true,
        cleanupPending: false,
      },
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
    const identities = db.connection.model('AppIdentity', identitySchema);
    await identities.updateMany(
      { accountId },
      { $max: { enrollmentCutoff: cutoff } },
      { session: db.context(ctx) },
    );
  }
  // vcli:begin email-actions
  async addAction(row: Action, ctx: TransactionContext): Promise<void> {
    const db = this.database;
    const actions = db.connection.model('AppAction', actionSchema);
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
    const actions = db.connection.model('AppAction', actionSchema);
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
  // vcli:end email-actions
  async list(accountId: string, ctx: TransactionContext): Promise<Identity[]> {
    return this.database.connection
      .model('AppIdentity', identitySchema)
      .find({ accountId })
      .sort({ key: 1 })
      .limit(33)
      .session(this.database.context(ctx))
      .select({ _id: 0, revision: 0 })
      .lean<Identity[]>()
      .exec();
  }
  async updateLifecycle(
    key: string,
    generation: number,
    patch: Pick<Identity, 'active' | 'cleanupPending' | 'methods'>,
    ctx: TransactionContext,
    advance = false,
  ): Promise<Identity> {
    const row = await this.database.connection
      .model('AppIdentity', identitySchema)
      .findOneAndUpdate(
        { _id: key, generation },
        {
          $set: { ...patch, ...(!patch.active ? { passwordHash: null } : {}) },
          $inc: {
            generation: advance ? 1 : 0,
            credentialVersion: patch.active ? 0 : 1,
          },
        },
        { session: this.database.context(ctx), returnDocument: 'after' },
      )
      .select({ _id: 0, revision: 0 })
      .lean<Identity>()
      .exec();
    if (!row) throw new ApplicationError('IDENTITY_CONFLICT', 409);
    return row;
  }
}

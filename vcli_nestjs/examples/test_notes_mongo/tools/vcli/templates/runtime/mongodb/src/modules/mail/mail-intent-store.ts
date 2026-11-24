import { createHash } from 'node:crypto';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { PreparedMailIntent } from '../../core/mail/action-delivery.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { mailIntentSchema } from './mail-intent.entity.js';
import {
  boundedMailLimit,
  validatePreparedMailIntent,
  type MailIntent,
  type MailIntentCompletion,
  type MailIntentPersistence,
  type MailIntentSummary,
} from './mail-intent-types.js';
export class MailIntentStore
  extends BaseRepository<MailIntent>
  implements MailIntentPersistence
{
  constructor(database: MongoDatabase) {
    super(database, 'MailIntent', mailIntentSchema, 'MAIL_OPERATION_CONFLICT');
  }
  async stage(
    prepared: PreparedMailIntent,
    context: TransactionContext,
  ): Promise<void> {
    validatePreparedMailIntent(prepared);
    const session = this.database.context(context),
      tag = createHash('sha256').update(prepared.payload).digest('hex');
    await this.model
      .updateOne(
        { _id: prepared.operationId },
        {
          $setOnInsert: {
            id: prepared.operationId,
            purpose: prepared.purpose,
            expiresAt: prepared.expiresAt,
            keyId: prepared.keyId,
            payload: prepared.payload,
            contentTag: tag,
            status: 'pending',
            attempts: 0,
            fence: 0,
            leaseUntil: 0,
            nextAttemptAt: 0,
            updatedAt: Date.now(),
          },
        },
        { upsert: true, session },
      )
      .exec();
    const current = await this.model
      .findOne({ _id: prepared.operationId }, null, { session })
      .lean()
      .exec();
    if (
      !current ||
      current.contentTag !== tag ||
      current.expiresAt !== prepared.expiresAt ||
      current.purpose !== prepared.purpose ||
      current.keyId !== prepared.keyId
    )
      throw new ApplicationError('MAIL_OPERATION_CONFLICT', 409);
  }
  async claim(
    now: number,
    leaseMs: number,
    maxAttempts: number,
  ): Promise<MailIntent | null> {
    return this.model
      .findOneAndUpdate(
        {
          status: { $in: ['pending', 'retry'] },
          nextAttemptAt: { $lte: now },
          expiresAt: { $gt: now },
          attempts: { $lt: maxAttempts },
        },
        {
          $set: {
            status: 'dispatching',
            leaseUntil: now + leaseMs,
            updatedAt: now,
          },
          $inc: { fence: 1, attempts: 1 },
        },
        { new: true, sort: { nextAttemptAt: 1, id: 1 } },
      )
      .lean()
      .exec();
  }
  async complete(
    id: string,
    fence: number,
    now: number,
    result: MailIntentCompletion,
  ): Promise<boolean> {
    const terminal = ['accepted', 'rejected'].includes(result.status);
    const value = await this.model
      .updateOne(
        {
          _id: id,
          fence,
          status: 'dispatching',
          leaseUntil: { $gt: now },
          expiresAt: { $gt: now },
        },
        {
          $set: {
            status: result.status,
            nextAttemptAt: result.nextAttemptAt,
            leaseUntil: 0,
            updatedAt: now,
            ...(terminal ? { payload: null } : {}),
          },
        },
      )
      .exec();
    return value.modifiedCount === 1;
  }
  async reconcile(
    id: string,
    fence: number,
    now: number,
    decision: 'accepted' | 'retry' | 'rejected',
    maxAttempts = 10,
  ): Promise<boolean> {
    const value = await this.model
      .updateOne(
        {
          _id: id,
          fence,
          status: 'unknown',
          expiresAt: { $gt: now },
          ...(decision === 'retry' ? { attempts: { $lt: maxAttempts } } : {}),
        },
        {
          $set: {
            status: decision,
            nextAttemptAt: now,
            updatedAt: now,
            ...(decision !== 'retry' ? { payload: null } : {}),
          },
          $inc: { fence: 1 },
        },
      )
      .exec();
    return value.modifiedCount === 1;
  }
  async maintain(now: number, limit: number): Promise<void> {
    boundedMailLimit(limit);
    const rows = await this.model
      .find({
        $or: [
          { expiresAt: { $lte: now }, payload: { $ne: null } },
          { status: 'dispatching', leaseUntil: { $lte: now } },
          {
            status: { $in: ['accepted', 'rejected', 'expired'] },
            updatedAt: { $lte: now - 86400000 },
          },
        ],
      })
      .limit(limit)
      .lean()
      .exec();
    for (const row of rows) {
      const filter = {
        _id: row.id,
        fence: row.fence,
        status: row.status,
        updatedAt: row.updatedAt,
      };
      if (
        ['accepted', 'rejected', 'expired'].includes(row.status) &&
        row.updatedAt <= now - 86400000
      )
        await this.model.deleteOne(filter).exec();
      else if (row.expiresAt <= now)
        await this.model
          .updateOne(filter, {
            $set: {
              status: 'expired',
              payload: null,
              leaseUntil: 0,
              updatedAt: now,
            },
            $inc: { fence: 1 },
          })
          .exec();
      else
        await this.model
          .updateOne(filter, {
            $set: { status: 'unknown', leaseUntil: 0, updatedAt: now },
            $inc: { fence: 1 },
          })
          .exec();
    }
  }
  async list(limit: number): Promise<MailIntentSummary[]> {
    const rows = await this.model
      .find(
        {},
        { _id: 0, id: 1, status: 1, attempts: 1, fence: 1, expiresAt: 1 },
      )
      .sort({ id: 1 })
      .limit(boundedMailLimit(limit))
      .lean()
      .exec();
    return rows.map(({ id, status, attempts, fence, expiresAt }) => ({
      id,
      status,
      attempts,
      fence,
      expiresAt,
    }));
  }
}

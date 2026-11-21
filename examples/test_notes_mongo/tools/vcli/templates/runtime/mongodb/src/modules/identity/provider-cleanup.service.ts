import { Injectable } from '@nestjs/common';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { ProviderCleanup } from './provider-cleanup.entity.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { providerCleanupSchema } from './provider-cleanup.entity.js';
@Injectable()
export class ProviderCleanupService {
  constructor(private readonly database: MongoDatabase) {}
  private get model() {
    return this.database.connection.model(
      'AppProviderCleanup',
      providerCleanupSchema,
    );
  }
  async stage(row: ProviderCleanup, ctx: TransactionContext): Promise<void> {
    await this.model.create([{ ...row, _id: row.id }], {
      session: this.database.context(ctx),
    });
  }
  async claim(
    now: number,
    leaseId: string,
    ctx: TransactionContext,
  ): Promise<ProviderCleanup | null> {
    const session = this.database.context(ctx);
    await this.model.findOneAndUpdate(
      { status: 'leased', action: 'unlink', leaseUntil: { $lte: now } },
      { $set: { status: 'unknown', lastCode: 'PROVIDER_UNKNOWN' } },
      { session, sort: { leaseUntil: 1, _id: 1 } },
    );
    return this.model
      .findOneAndUpdate(
        {
          attempts: { $lt: 8 },
          nextAttemptAt: { $lte: now },
          $or: [
            { status: { $in: ['pending', 'retry'] } },
            { action: { $ne: 'unlink' }, status: 'unknown' },
            {
              action: { $ne: 'unlink' },
              status: 'leased',
              leaseUntil: { $lte: now },
            },
          ],
        },
        {
          $set: { status: 'leased', leaseId, leaseUntil: now + 30000 },
          $inc: { attempts: 1 },
        },
        { session, sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' },
      )
      .select({ _id: 0 })
      .lean<ProviderCleanup>()
      .exec();
  }
  async settle(
    row: ProviderCleanup,
    status: ProviderCleanup['status'],
    code: ProviderCleanup['lastCode'],
    now: number,
    ctx: TransactionContext,
  ): Promise<boolean> {
    const result = await this.model.updateOne(
      { _id: row.id, status: 'leased', leaseId: row.leaseId },
      {
        $set: {
          status,
          lastCode: code,
          nextAttemptAt: now + Math.min(3600000, 1000 * 2 ** row.attempts),
          completedAt: status === 'completed' ? now : null,
          leaseUntil: 0,
        },
      },
      { session: this.database.context(ctx) },
    );
    return result.modifiedCount === 1;
  }
}

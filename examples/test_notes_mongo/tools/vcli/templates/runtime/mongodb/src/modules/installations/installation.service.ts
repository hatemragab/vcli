import type { TransactionContext } from '../../core/database/transaction-context.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import {
  installationSchema,
  type Installation,
} from './installation.entity.js';
@Injectable()
export class InstallationService extends BaseRepository<Installation> {
  constructor(database: MongoDatabase) {
    super(
      database,
      'AppInstallation',
      installationSchema,
      'INSTALLATION_EXISTS',
    );
  }

  async enroll(
    id: string,
    accountId: string,
    capabilityHash: string,
    platform: Installation['platform'],
    now: number,
    allowRebind: boolean,
    ctx: TransactionContext,
  ): Promise<Installation> {
    const row = await this.model
      .findOneAndUpdate(
        { capabilityHash },
        { $inc: { revision: 1 } },
        { session: this.database.context(ctx), returnDocument: 'after' },
      )
      .select({ _id: 0, revision: 0 })
      .lean<Installation>()
      .exec();
    if (!row)
      return this.create(
        {
          id,
          accountId,
          capabilityHash,
          generation: 1,
          platform,
          createdAt: now,
        },
        { context: ctx },
      );
    if (row.accountId === accountId) return row;
    if (!allowRebind)
      throw new ApplicationError(
        'INSTALLATION_SWITCH_CONFIRMATION_REQUIRED',
        409,
      );
    if (row.generation >= 2147483647)
      throw new ApplicationError('INSTALLATION_GENERATION_EXHAUSTED', 409);
    const changed = await this.model.updateOne(
      { _id: row.id, generation: row.generation },
      { $set: { accountId, platform }, $inc: { generation: 1 } },
      { session: this.database.context(ctx) },
    );
    if (changed.modifiedCount !== 1)
      throw new ApplicationError('INSTALLATION_CONFLICT', 409);
    return { ...row, accountId, generation: row.generation + 1, platform };
  }

  async rotateCapability(
    id: string,
    accountId: string,
    oldHash: string,
    newHash: string,
    ctx: TransactionContext,
  ): Promise<number> {
    const result = await this.model
      .findOneAndUpdate(
        {
          _id: id,
          accountId,
          capabilityHash: oldHash,
          generation: { $lt: 2147483647 },
        },
        { $set: { capabilityHash: newHash }, $inc: { generation: 1 } },
        { session: this.database.context(ctx), returnDocument: 'after' },
      )
      .select({ _id: 0, generation: 1 })
      .lean<{ generation: number }>()
      .exec();
    if (!result) throw new ApplicationError('INSTALLATION_PROOF_REQUIRED', 401);
    return result.generation;
  }
}

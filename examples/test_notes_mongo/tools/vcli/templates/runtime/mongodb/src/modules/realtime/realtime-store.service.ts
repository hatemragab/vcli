import { Injectable } from '@nestjs/common';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type {
  AdmissionTicket,
  RealtimeBinding,
  RealtimeStore,
  TicketPurpose,
} from '../../core/realtime/realtime-store.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  bindingSchema,
  principalSchema,
  type RealtimeRow,
} from './realtime-records.js';
@Injectable()
export class RealtimeStoreService implements RealtimeStore {
  constructor(private readonly database: MongoDatabase) {}
  private get records() {
    return this.database.connection.db!.collection<RealtimeRow>(
      'vcli_realtime_records',
    );
  }
  async assertInitialized(): Promise<void> {
    if (
      !(await this.database.connection
        .db!.collection('ref_migrations')
        .findOne({ name: 'realtime-v1', completed: true }))
    )
      throw new ApplicationError('REALTIME_INITIALIZATION_REQUIRED', 503);
  }
  async issue(ticket: AdmissionTicket, now: number): Promise<void> {
    await this.database.run(async (context) => {
      const session = this.database.context(context),
        options = { session };
      const lock = await this.records.updateOne(
        { _id: 'lock' },
        { $inc: { count: 1 } },
        options,
      );
      if (lock.matchedCount !== 1)
        throw new ApplicationError('REALTIME_INITIALIZATION_REQUIRED', 503);
      await this.records.deleteMany({ expiresAt: { $lte: now } }, options);
      const total = await this.records.countDocuments(
        { kind: 'ticket' },
        options,
      );
      const own = await this.records.countDocuments(
        { kind: 'ticket', sessionId: ticket.principal.sessionId },
        options,
      );
      const rateId = 'rate:' + ticket.principal.sessionId;
      const rate = await this.records.findOne({ _id: rateId }, options);
      if (
        total >= 512 ||
        own >= 4 ||
        (rate?.count ?? 0) >= 10 ||
        (!rate &&
          (await this.records.countDocuments({ kind: 'rate' }, options)) >= 512)
      )
        throw new ApplicationError('REALTIME_LIMIT', 429);
      await this.records.insertOne(
        {
          _id: ticket.hash,
          kind: 'ticket',
          sessionId: ticket.principal.sessionId,
          purpose: ticket.purpose,
          expiresAt: ticket.expiresAt,
          data: ticket.principal,
        },
        options,
      );
      await this.records.updateOne(
        { _id: rateId },
        {
          $inc: { count: 1 },
          $setOnInsert: {
            kind: 'rate',
            sessionId: ticket.principal.sessionId,
            expiresAt: now + 60000,
          },
        },
        { ...options, upsert: true },
      );
    });
  }
  async consume(
    hash: string,
    purpose: TicketPurpose,
    now: number,
  ): Promise<Principal | null> {
    const record = await this.records.findOneAndDelete({
      _id: hash,
      kind: 'ticket',
      purpose,
      expiresAt: { $gt: now },
    });
    return record ? principalSchema.parse(record.data) : null;
  }
  async addBinding(binding: RealtimeBinding, now: number): Promise<void> {
    bindingSchema.parse(binding);
    await this.database.run(async (context) => {
      const options = { session: this.database.context(context) };
      const lock = await this.records.updateOne(
        { _id: 'lock' },
        { $inc: { count: 1 } },
        options,
      );
      if (lock.matchedCount !== 1)
        throw new ApplicationError('REALTIME_INITIALIZATION_REQUIRED', 503);
      await this.records.deleteMany(
        { kind: 'binding', expiresAt: { $lte: now } },
        options,
      );
      if (
        (await this.records.countDocuments({ kind: 'binding' }, options)) >=
          128 ||
        (await this.records.countDocuments(
          { kind: 'binding', sessionId: binding.principal.sessionId },
          options,
        )) >= 8
      )
        throw new ApplicationError('REALTIME_LIMIT', 429);
      await this.records.insertOne(
        {
          _id: 'binding:' + binding.client,
          kind: 'binding',
          sessionId: binding.principal.sessionId,
          accountId: binding.principal.accountId,
          expiresAt: binding.expiresAt,
          data: binding,
        },
        options,
      );
    });
  }
  async binding(client: string): Promise<RealtimeBinding | null> {
    const row = await this.records.findOne({
      _id: 'binding:' + client,
      kind: 'binding',
    });
    return row ? bindingSchema.parse(row.data) : null;
  }
  async bindings(accountId?: string): Promise<readonly RealtimeBinding[]> {
    const rows = await this.records
      .find({
        kind: 'binding',
        ...(accountId === undefined ? {} : { accountId }),
      })
      .limit(129)
      .toArray();
    if (rows.length > 128) throw new ApplicationError('REALTIME_LIMIT', 503);
    return rows.map((row) => bindingSchema.parse(row.data));
  }
  async touchBinding(
    binding: RealtimeBinding,
    expiresAt: number,
  ): Promise<boolean> {
    const result = await this.records.updateOne(
      {
        _id: 'binding:' + binding.client,
        'data.user': binding.user,
        expiresAt: binding.expiresAt,
        $and: [{ expiresAt: { $gt: Date.now() } }],
      },
      { $set: { expiresAt, data: { ...binding, expiresAt } } },
    );
    return result.matchedCount === 1;
  }
  async removeBinding(binding: RealtimeBinding): Promise<boolean> {
    const result = await this.records.deleteOne({
      _id: 'binding:' + binding.client,
      'data.user': binding.user,
      expiresAt: binding.expiresAt,
    });
    return result.deletedCount === 1;
  }
  async heartbeat(nodeId: string, expiresAt: number): Promise<void> {
    await this.database.run(async (context) => {
      const options = { session: this.database.context(context) };
      const lock = await this.records.updateOne(
        { _id: 'lock' },
        { $inc: { count: 1 } },
        options,
      );
      if (lock.matchedCount !== 1)
        throw new ApplicationError('REALTIME_INITIALIZATION_REQUIRED', 503);
      await this.records.deleteMany(
        { kind: 'node', expiresAt: { $lte: Date.now() } },
        options,
      );
      if (
        (await this.records.countDocuments(
          { kind: 'node', _id: { $ne: 'node:' + nodeId } },
          options,
        )) >= 16
      )
        throw new ApplicationError('REALTIME_NODE_LIMIT', 503);
      await this.records.updateOne(
        { _id: 'node:' + nodeId },
        { $set: { kind: 'node', expiresAt } },
        { ...options, upsert: true },
      );
    });
  }
  async nodes(now: number): Promise<readonly string[]> {
    const rows = await this.records
      .find({ kind: 'node', expiresAt: { $gt: now } })
      .limit(17)
      .toArray();
    if (rows.length > 16)
      throw new ApplicationError('REALTIME_NODE_LIMIT', 503);
    return rows.map((row) => row._id.slice(5));
  }
  async removeNode(nodeId: string): Promise<void> {
    await this.records.deleteOne({ _id: 'node:' + nodeId, kind: 'node' });
  }
}

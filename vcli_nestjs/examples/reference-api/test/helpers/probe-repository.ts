import { Schema } from 'mongoose';
import { BaseRepository } from '../../dist/core/database/base-repository.js';
import type { MongoDatabase } from '../../dist/core/database/mongo-database.js';

export type Probe = Readonly<{
  id: string;
  title: string;
  visits: number;
  parentId: string | null;
  nickname?: string;
  alias?: string;
}>;

/** A test-owned native model that exercises middleware, population and schema validation. */
export class ProbeRepository extends BaseRepository<Probe> {
  readonly hooks: { saves: number; bulkWrites: number };
  constructor(database: MongoDatabase, name: string) {
    const hooks = { saves: 0, bulkWrites: 0 };
    const schema = new Schema<Probe>(
      {
        id: { type: String, required: true },
        title: { type: String, required: true, maxlength: 100 },
        visits: { type: Number, required: true, min: 0 },
        parentId: { type: String, ref: name, default: null },
        nickname: String,
        alias: String,
      },
      {
        collection: name,
        versionKey: false,
        autoCreate: false,
        autoIndex: false,
      },
    );
    schema.add(new Schema({ _id: String }));
    schema.pre('save', () => {
      hooks.saves += 1;
    });
    schema.pre('bulkWrite', () => {
      hooks.bulkWrites += 1;
    });
    super(database, name, schema, 'PROBE_CONFLICT');
    this.hooks = hooks;
  }
  async initialize() {
    await this.model.createCollection();
  }
}

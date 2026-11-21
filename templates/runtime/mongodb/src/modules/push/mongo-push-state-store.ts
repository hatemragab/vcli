import {
  createConnection,
  Schema,
  type Connection,
  type Model,
} from 'mongoose';
import { ApplicationError } from '../../core/errors/application-error.js';
import { emptyPushState, type PushState } from './push.entity.js';
import type { PushStateStore } from './push-state-store.js';
import { decodePushState } from './push-storage-mapping.js';
type PushDocument = {
  _id: string;
  revision: number;
  destinations: unknown[];
};
const pushSchema = new Schema<PushDocument>(
  {
    _id: { type: String, required: true },
    revision: { type: Number, required: true },
    destinations: { type: [Schema.Types.Mixed], required: true },
  },
  {
    collection: 'app_push_state',
    versionKey: false,
    autoCreate: false,
    autoIndex: false,
  },
);
export class MongoPushStateStore implements PushStateStore {
  private readonly model: Model<PushDocument>;
  private constructor(private readonly connection: Connection) {
    this.model = connection.model<PushDocument>('PushState', pushSchema);
  }
  static async connect(
    url: string,
    initialize = false,
  ): Promise<MongoPushStateStore> {
    const connection = await createConnection(url, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 3,
      autoCreate: false,
      autoIndex: false,
    }).asPromise();
    const store = new MongoPushStateStore(connection);
    try {
      if (initialize) await store.model.createCollection();
      else if (
        !(await connection.db
          ?.listCollections({ name: 'app_push_state' })
          .hasNext())
      )
        throw new ApplicationError('PUSH_SCHEMA_NOT_INITIALIZED', 500);
      return store;
    } catch (error: unknown) {
      await connection.close();
      throw error;
    }
  }
  async read(): Promise<PushState> {
    const state = await this.model.findById('destinations').lean().exec();
    return state
      ? decodePushState({
          revision: state.revision,
          destinations: state.destinations,
        })
      : emptyPushState();
  }
  async change(update: (state: PushState) => PushState): Promise<PushState> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const current = await this.read();
      const next = decodePushState(update(current));
      try {
        const result = await this.model
          .replaceOne(
            { _id: 'destinations', revision: current.revision },
            { _id: 'destinations', ...next },
            { upsert: current.revision === 0 },
          )
          .exec();
        if (result.modifiedCount === 1 || result.upsertedCount === 1)
          return next;
      } catch (error: unknown) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 11000
        ))
          throw error;
      }
    }
    throw new ApplicationError('PUSH_STATE_BUSY', 503);
  }
  async close(): Promise<void> {
    await this.connection.close();
  }
}

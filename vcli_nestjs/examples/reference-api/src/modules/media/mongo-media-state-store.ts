import {
  createConnection,
  Schema,
  type Connection,
  type Model,
} from 'mongoose';
import { ApplicationError } from '../../core/errors/application-error.js';
import { emptyMediaState, type MediaOwnerState } from './media.entity.js';
import type { MediaStateStore } from './media-state-store.js';
import { decodeMediaState } from './media-storage-mapping.js';
type MediaDocument = {
  _id: string;
  revision: number;
  entries: unknown[];
};
const mediaSchema = new Schema<MediaDocument>(
  {
    _id: { type: String, required: true },
    revision: { type: Number, required: true },
    entries: { type: [Schema.Types.Mixed], required: true },
  },
  {
    versionKey: false,
    collection: 'reference_media_owners',
    autoCreate: false,
    autoIndex: false,
  },
);
export class MongoMediaStateStore implements MediaStateStore {
  private readonly model: Model<MediaDocument>;
  private constructor(private readonly connection: Connection) {
    this.model = connection.model<MediaDocument>('MediaOwner', mediaSchema);
  }
  static async connect(
    url: string,
    initialize = false,
  ): Promise<MongoMediaStateStore> {
    const connection = await createConnection(url, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 3,
      autoCreate: false,
      autoIndex: false,
    }).asPromise();
    const store = new MongoMediaStateStore(connection);
    try {
      if (initialize) await store.model.createCollection();
      else if (
        !(await connection.db
          ?.listCollections({ name: 'reference_media_owners' })
          .hasNext())
      )
        throw new ApplicationError('MEDIA_SCHEMA_NOT_INITIALIZED', 500);
      return store;
    } catch (error: unknown) {
      await connection.close();
      throw error;
    }
  }
  async read(ownerId: string): Promise<MediaOwnerState> {
    const document = await this.model.findById(ownerId).lean().exec();
    if (!document) return emptyMediaState();
    return decodeMediaState(
      { revision: document.revision, entries: document.entries },
      ownerId,
    );
  }
  async change(
    ownerId: string,
    update: (state: MediaOwnerState) => MediaOwnerState,
  ): Promise<MediaOwnerState> {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const current = await this.read(ownerId);
      const next = update(current);
      try {
        const result = await this.model
          .replaceOne(
            { _id: ownerId, revision: current.revision },
            { _id: ownerId, ...next },
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
    throw new ApplicationError('MEDIA_BUSY', 503);
  }
  async close(): Promise<void> {
    await this.connection.close();
  }
}

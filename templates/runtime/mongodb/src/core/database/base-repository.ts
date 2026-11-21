import type {
  AggregateOptions,
  AnyBulkWriteOperation,
  ClientSession,
  DeleteResult,
  Model,
  MongooseBulkWriteOptions,
  PipelineStage,
  PopulateOptions,
  QueryFilter,
  Schema,
  UpdateQuery,
  UpdateResult,
} from 'mongoose';
import type { MongoDatabase } from './mongo-database.js';
import type {
  IterationOptions,
  PaginatedResult,
  PaginationOptions,
  RepositoryBulkResult,
  RepositoryDocument,
  RepositoryEntity,
  RepositoryFilter,
  RepositoryReadOptions,
  RepositoryViewOptions,
  RepositoryWriteOptions,
} from './repository-types.js';
import { ApplicationError } from '../errors/application-error.js';
import { databaseErrorCode } from './database-errors.js';
type Native<T extends RepositoryEntity> = RepositoryDocument<T>;
type Read<T extends RepositoryEntity> = RepositoryReadOptions<T>;
type View<T extends RepositoryEntity> = RepositoryViewOptions<T>;
type Write = RepositoryWriteOptions;
type Projection<T extends RepositoryEntity> = Omit<View<T>, 'populate'> & {
  populate?: never;
};
type DistinctValue<Value> = Value extends readonly (infer Item)[]
  ? Item
  : Value;
/** Native internal data capability; HTTP authorization belongs to the feature owner. */
export abstract class BaseRepository<T extends RepositoryEntity> {
  protected readonly model: Model<Native<T>>;
  private readonly fields: Record<string, 1>;
  protected constructor(
    protected readonly database: MongoDatabase,
    modelName: string,
    schema: Schema<T>,
    private readonly duplicateCode = 'RECORD_CONFLICT',
  ) {
    if (
      schema.path('_id')?.instance !== 'String' ||
      schema.path('id')?.instance !== 'String'
    )
      throw new ApplicationError('STRING_REPOSITORY_ID_REQUIRED', 500);
    schema.set('strict', 'throw');
    schema.set('strictQuery', 'throw');
    schema.path('id').immutable(true);
    // Every owner schema declares string _id; Schema<T> describes its public record.
    this.model = database.connection.model<Native<T>>(
      modelName,
      schema as unknown as Schema<Native<T>>,
    );
    this.fields = Object.fromEntries(
      Object.keys(schema.paths)
        .filter((key) => !['_id', '__v', 'revision'].includes(key))
        .map((key) => [key, 1]),
    );
  }
  private session(options: Write): ClientSession | undefined {
    const session = options.context
      ? this.database.context(options.context)
      : options.session;
    if (options.context && options.session && session !== options.session)
      throw new ApplicationError('AMBIGUOUS_TRANSACTION_CONTEXT', 400);

    return session;
  }
  /** Public id predicates always use Mongo's indexed string primary key, including logical branches. */
  private filter(filter: RepositoryFilter<T>): QueryFilter<Native<T>> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (key === 'id') {
        if (Object.hasOwn(filter, '_id'))
          throw new ApplicationError('AMBIGUOUS_REPOSITORY_ID', 400);
        result._id = value;
      } else if (
        ['$and', '$or', '$nor'].includes(key) &&
        Array.isArray(value)
      ) {
        result[key] = value.map((entry: RepositoryFilter<T>) =>
          this.filter(entry),
        );
      } else result[key] = value;
    }
    return result as QueryFilter<Native<T>>;
  }
  private bounded(
    value: number,
    maximum: number,
    code = 'INVALID_LIMIT',
  ): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new ApplicationError(code, 400);
    return value;
  }
  private guardFilter(filter: RepositoryFilter<T>, options: Write): void {
    if (!Object.keys(filter).length && !options.allowAll)
      throw new ApplicationError('WHOLE_COLLECTION_OPT_IN_REQUIRED', 400);
  }
  private guardUpdate(update: UpdateQuery<Native<T>>): void {
    if (Array.isArray(update) || !Object.keys(update).length)
      throw new ApplicationError('INVALID_REPOSITORY_UPDATE', 400);
    for (const [operator, changes] of Object.entries(update)) {
      if (!operator.startsWith('$') || !changes || typeof changes !== 'object')
        throw new ApplicationError('UPDATE_OPERATORS_REQUIRED', 400);
      for (const [path, value] of Object.entries(changes)) {
        if (
          ['id', '_id'].includes(path.split('.')[0]!) ||
          (operator === '$rename' &&
            typeof value === 'string' &&
            ['id', '_id'].includes(value.split('.')[0]!))
        )
          throw new ApplicationError('IMMUTABLE_REPOSITORY_ID', 400);
      }
    }
  }
  private sort(options: View<T>, stable = false) {
    const sort: Record<string, import('mongoose').SortOrder> = {};
    for (const [key, value] of Object.entries(options.sort ?? {})) {
      const nativeKey = key === 'id' ? '_id' : key;
      if (Object.hasOwn(sort, nativeKey))
        throw new ApplicationError('AMBIGUOUS_REPOSITORY_ID', 400);
      sort[nativeKey] = value;
    }
    if (stable && !Object.hasOwn(sort, '_id')) sort._id = 1;
    return sort;
  }
  private projection(options: View<T>) {
    return options.projection === undefined
      ? { ...this.fields, _id: 0 }
      : options.projection;
  }
  private population(
    value: PopulateOptions | PopulateOptions[],
    options: Write,
  ): PopulateOptions[] {
    const session = this.session(options);
    return (Array.isArray(value) ? value : [value]).map((entry) => {
      if (entry.options?.session && entry.options.session !== session)
        throw new ApplicationError('AMBIGUOUS_TRANSACTION_CONTEXT', 400);
      const nested = entry.populate;
      return {
        ...entry,
        ordered: session?.inTransaction() ? true : entry.ordered,
        options: { ...entry.options, session: session ?? null, lean: true },
        ...(nested
          ? {
              populate: this.population(
                (Array.isArray(nested) ? nested : [nested]).map((path) =>
                  typeof path === 'string' ? { path } : path,
                ),
                options,
              ),
            }
          : {}),
      };
    });
  }
  private async write<R>(work: () => Promise<R>): Promise<R> {
    try {
      return await work();
    } catch (error) {
      if (databaseErrorCode(error) === 11000)
        throw new ApplicationError(this.duplicateCode, 409);
      if (
        error instanceof Error &&
        ['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)
      )
        throw new ApplicationError('INVALID_REPOSITORY_INPUT', 400);
      throw error;
    }
  }
  async create(entity: T, options: Write = {}): Promise<T> {
    if (!entity.id || typeof entity.id !== 'string')
      throw new ApplicationError('INVALID_REPOSITORY_INPUT', 400);
    return this.write(async () => {
      const document = new this.model({ ...entity, _id: entity.id });
      await document.save({ session: this.session(options) });
      const row = document.toObject();
      return Object.fromEntries(
        Object.entries(row).filter(([key]) => Object.hasOwn(this.fields, key)),
      ) as T;
    });
  }
  /** Atomic, sequential save/validation middleware on one session, including rollback on any failure. */
  async createMany(entities: readonly T[], options: Write = {}): Promise<T[]> {
    this.bounded(entities.length, 1000, 'INVALID_BATCH_SIZE');
    const work = async (selected: Write) => {
      const results: T[] = [];
      for (const entity of entities)
        results.push(await this.create(entity, selected));
      return results;
    };
    const session = this.session(options);
    if (session) {
      if (!session.inTransaction())
        throw new ApplicationError('ACTIVE_TRANSACTION_REQUIRED', 400);
      return work(options);
    }
    return this.database.run((context) => work({ context }));
  }
  findById(id: string, options?: Read<T>): Promise<T | null>;
  findById<R extends object = Partial<T>>(
    id: string,
    options: Projection<T>,
  ): Promise<R | null>;
  findById<R extends object = Record<string, unknown>>(
    id: string,
    options: View<T>,
  ): Promise<R | null>;
  findById(id: string, options: View<T> = {}): Promise<Partial<T> | null> {
    return this.readOne({ _id: id } as RepositoryFilter<T>, options);
  }
  findByIdOrThrow(id: string, options?: Read<T>): Promise<T>;
  findByIdOrThrow<R extends object = Partial<T>>(
    id: string,
    options: Projection<T>,
  ): Promise<R>;
  findByIdOrThrow<R extends object = Record<string, unknown>>(
    id: string,
    options: View<T>,
  ): Promise<R>;
  async findByIdOrThrow(
    id: string,
    options: View<T> = {},
  ): Promise<Partial<T>> {
    return this.required(
      await this.readOne({ _id: id } as RepositoryFilter<T>, options),
    );
  }
  findOne(filter: RepositoryFilter<T>, options?: Read<T>): Promise<T | null>;
  findOne<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    options: Projection<T>,
  ): Promise<R | null>;
  findOne<R extends object = Record<string, unknown>>(
    filter: RepositoryFilter<T>,
    options: View<T>,
  ): Promise<R | null>;
  findOne(
    filter: RepositoryFilter<T>,
    options: View<T> = {},
  ): Promise<Partial<T> | null> {
    return this.readOne(filter, options);
  }
  findOneOrThrow(filter: RepositoryFilter<T>, options?: Read<T>): Promise<T>;
  findOneOrThrow<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    options: Projection<T>,
  ): Promise<R>;
  findOneOrThrow<R extends object = Record<string, unknown>>(
    filter: RepositoryFilter<T>,
    options: View<T>,
  ): Promise<R>;
  async findOneOrThrow(
    filter: RepositoryFilter<T>,
    options: View<T> = {},
  ): Promise<Partial<T>> {
    return this.required(await this.readOne(filter, options));
  }
  private required<R>(row: R | null): R {
    if (row === null) throw new ApplicationError('RECORD_NOT_FOUND', 404);
    return row;
  }
  private readOne<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    options: View<T>,
  ): Promise<R | null> {
    const query = this.model
      .findOne(this.filter(filter))
      .select(this.projection(options))
      .session(this.session(options) ?? null);
    if (options.sort) query.sort(this.sort(options));
    if (options.populate)
      query.populate(this.population(options.populate, options));
    return query.lean<R>().exec();
  }
  findMany(filter?: RepositoryFilter<T>, options?: Read<T>): Promise<T[]>;
  findMany<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    options: Projection<T>,
  ): Promise<R[]>;
  findMany<R extends object = Record<string, unknown>>(
    filter: RepositoryFilter<T>,
    options: View<T>,
  ): Promise<R[]>;
  findMany(
    filter: RepositoryFilter<T> = {},
    options: View<T> = {},
  ): Promise<Partial<T>[]> {
    return this.readMany(filter, options);
  }
  private readMany<R extends object>(
    filter: RepositoryFilter<T>,
    options: View<T>,
    skip = 0,
  ): Promise<R[]> {
    const query = this.model
      .find(this.filter(filter))
      .select(this.projection(options))
      .sort(this.sort(options, true))
      .collation({ locale: 'simple' })
      .skip(skip)
      .limit(this.bounded(options.limit ?? 100, 1000))
      .session(this.session(options) ?? null);
    if (options.populate)
      query.populate(this.population(options.populate, options));
    return query.lean<R[]>().exec();
  }
  async exists(
    filter: RepositoryFilter<T>,
    options: Write = {},
  ): Promise<boolean> {
    return (
      (await this.model
        .exists(this.filter(filter))
        .session(this.session(options) ?? null)
        .exec()) !== null
    );
  }
  count(
    filter: RepositoryFilter<T> = {},
    options: Write = {},
  ): Promise<number> {
    return this.model
      .countDocuments(this.filter(filter))
      .session(this.session(options) ?? null)
      .exec();
  }
  async distinct<K extends Extract<keyof T, string>>(
    field: K,
    filter: RepositoryFilter<T> = {},
    options: Write = {},
  ): Promise<DistinctValue<T[K]>[]> {
    return this.model
      .distinct(field === 'id' ? '_id' : field, this.filter(filter))
      .session(this.session(options) ?? null)
      .exec() as Promise<DistinctValue<T[K]>[]>;
  }
  findWithPagination(
    pagination?: PaginationOptions,
    filter?: RepositoryFilter<T>,
    options?: Read<T>,
  ): Promise<PaginatedResult<T>>;
  findWithPagination<R extends object = Partial<T>>(
    pagination: PaginationOptions,
    filter: RepositoryFilter<T>,
    options: Projection<T>,
  ): Promise<PaginatedResult<R>>;
  findWithPagination<R extends object = Record<string, unknown>>(
    pagination: PaginationOptions,
    filter: RepositoryFilter<T>,
    options: View<T>,
  ): Promise<PaginatedResult<R>>;
  async findWithPagination(
    pagination: PaginationOptions = {},
    filter: RepositoryFilter<T> = {},
    options: View<T> = {},
  ): Promise<PaginatedResult<Partial<T>>> {
    const page = this.bounded(
      pagination.page ?? 1,
      1000001,
      'INVALID_PAGINATION',
    );
    const limit = this.bounded(
      pagination.limit ?? 20,
      100,
      'INVALID_PAGINATION',
    );
    const skip = (page - 1) * limit;
    if (skip > 1000000) throw new ApplicationError('INVALID_PAGINATION', 400);
    // Sequential operations: Mongo forbids parallel work within the caller's transaction.
    const data = await this.readMany<Partial<T>>(
      filter,
      { ...options, limit },
      skip,
    );
    const totalCount = await this.count(filter, options),
      totalPages = Math.ceil(totalCount / limit);
    return {
      data,
      totalCount,
      totalPages,
      currentPage: page,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }
  updateOne(
    filter: RepositoryFilter<T>,
    update: UpdateQuery<Native<T>>,
    options: Write = {},
  ): Promise<UpdateResult> {
    this.guardFilter(filter, options);
    this.guardUpdate(update);
    return this.write(() =>
      this.model
        .updateOne(this.filter(filter), update, {
          session: this.session(options),
          runValidators: true,
        })
        .exec(),
    );
  }
  updateMany(
    filter: RepositoryFilter<T>,
    update: UpdateQuery<Native<T>>,
    options: Write = {},
  ): Promise<UpdateResult> {
    this.guardFilter(filter, options);
    this.guardUpdate(update);
    return this.write(() =>
      this.model
        .updateMany(this.filter(filter), update, {
          session: this.session(options),
          runValidators: true,
        })
        .exec(),
    );
  }
  findByIdAndUpdate(
    id: string,
    update: UpdateQuery<Native<T>>,
    options?: Read<T>,
  ): Promise<T | null>;
  findByIdAndUpdate<R extends object = Partial<T>>(
    id: string,
    update: UpdateQuery<Native<T>>,
    options: Projection<T>,
  ): Promise<R | null>;
  findByIdAndUpdate<R extends object = Record<string, unknown>>(
    id: string,
    update: UpdateQuery<Native<T>>,
    options: View<T>,
  ): Promise<R | null>;
  findByIdAndUpdate(
    id: string,
    update: UpdateQuery<Native<T>>,
    options: View<T> = {},
  ): Promise<Partial<T> | null> {
    return this.findOneAndUpdate(
      { _id: id } as RepositoryFilter<T>,
      update,
      options,
    );
  }

  findOneAndUpdate(
    filter: RepositoryFilter<T>,
    update: UpdateQuery<Native<T>>,
    options?: Read<T>,
  ): Promise<T | null>;
  findOneAndUpdate<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    update: UpdateQuery<Native<T>>,
    options: Projection<T>,
  ): Promise<R | null>;
  findOneAndUpdate<R extends object = Record<string, unknown>>(
    filter: RepositoryFilter<T>,
    update: UpdateQuery<Native<T>>,
    options: View<T>,
  ): Promise<R | null>;
  findOneAndUpdate(
    filter: RepositoryFilter<T>,
    update: UpdateQuery<Native<T>>,
    options: View<T> = {},
  ): Promise<Partial<T> | null> {
    this.guardFilter(filter, options);
    this.guardUpdate(update);
    return this.write(async () => {
      const query = this.model
        .findOneAndUpdate(this.filter(filter), update, {
          session: this.session(options),
          returnDocument: 'after',
          runValidators: true,
          sort: this.sort(options),
        })
        .select(this.projection(options));
      if (options.populate)
        query.populate(this.population(options.populate, options));
      return query.lean<Partial<T>>().exec();
    });
  }
  /** Explicit keyed upsert: immutable public id and native _id always agree. */
  async upsert(
    id: string,
    insert: T,
    update: UpdateQuery<Native<T>>,
    options: Write = {},
  ): Promise<T> {
    if (!id || id !== insert.id)
      throw new ApplicationError('INVALID_REPOSITORY_INPUT', 400);
    this.guardUpdate(update);
    // Validate the complete insertion candidate; native update validators do not validate untouched fields.
    await this.write(() => new this.model({ ...insert, _id: id }).validate());
    const insertion: Record<string, unknown> = {
      ...insert,
      ...update.$setOnInsert,
    };
    for (const [operator, values] of Object.entries(update)) {
      if (operator === '$setOnInsert' || !values || typeof values !== 'object')
        continue;
      const paths = [
        ...Object.keys(values),
        ...(operator === '$rename'
          ? Object.values(values).filter(
              (value): value is string => typeof value === 'string',
            )
          : []),
      ];
      for (const path of paths) {
        for (const key of Object.keys(insertion))
          if (
            key === path ||
            key.startsWith(path + '.') ||
            path.startsWith(key + '.')
          )
            delete insertion[key];
      }
    }
    return this.write(async () =>
      this.required(
        await this.model
          .findOneAndUpdate(
            { _id: id } as QueryFilter<Native<T>>,
            {
              ...update,
              $setOnInsert: { ...insertion, _id: id, id },
            },
            {
              upsert: true,
              session: this.session(options),
              returnDocument: 'after',
              runValidators: true,
            },
          )
          .select(this.projection({}))
          .lean<T>()
          .exec(),
      ),
    );
  }
  deleteOne(
    filter: RepositoryFilter<T>,
    options: Write = {},
  ): Promise<DeleteResult> {
    this.guardFilter(filter, options);
    return this.model
      .deleteOne(this.filter(filter), { session: this.session(options) })
      .exec();
  }
  deleteMany(
    filter: RepositoryFilter<T>,
    options: Write = {},
  ): Promise<DeleteResult> {
    this.guardFilter(filter, options);
    return this.model
      .deleteMany(this.filter(filter), { session: this.session(options) })
      .exec();
  }
  findByIdAndDelete(id: string, options?: Read<T>): Promise<T | null>;
  findByIdAndDelete<R extends object = Partial<T>>(
    id: string,
    options: Projection<T>,
  ): Promise<R | null>;
  findByIdAndDelete<R extends object = Record<string, unknown>>(
    id: string,
    options: View<T>,
  ): Promise<R | null>;
  findByIdAndDelete(
    id: string,
    options: View<T> = {},
  ): Promise<Partial<T> | null> {
    return this.findOneAndDelete({ _id: id } as RepositoryFilter<T>, options);
  }

  findOneAndDelete(
    filter: RepositoryFilter<T>,
    options?: Read<T>,
  ): Promise<T | null>;
  findOneAndDelete<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    options: Projection<T>,
  ): Promise<R | null>;
  findOneAndDelete<R extends object = Record<string, unknown>>(
    filter: RepositoryFilter<T>,
    options: View<T>,
  ): Promise<R | null>;
  findOneAndDelete(
    filter: RepositoryFilter<T>,
    options: View<T> = {},
  ): Promise<Partial<T> | null> {
    this.guardFilter(filter, options);
    const query = this.model
      .findOneAndDelete(this.filter(filter), {
        session: this.session(options),
        sort: this.sort(options),
      })
      .select(this.projection(options));
    if (options.populate)
      query.populate(this.population(options.populate, options));
    return query.lean<Partial<T>>().exec();
  }
  /** Bounded cursor, unique sort tie-breaker, serial consumption and guaranteed cursor close. */
  iterate(
    filter?: RepositoryFilter<T>,
    options?: Read<T> & Readonly<{ batchSize?: number; maximum?: number }>,
  ): AsyncGenerator<T>;
  iterate<R extends object = Partial<T>>(
    filter: RepositoryFilter<T>,
    options: Omit<IterationOptions<T>, 'populate'> & { populate?: never },
  ): AsyncGenerator<R>;
  iterate<R extends object = Record<string, unknown>>(
    filter: RepositoryFilter<T>,
    options: IterationOptions<T>,
  ): AsyncGenerator<R>;
  async *iterate<R extends object = Partial<T>>(
    filter: RepositoryFilter<T> = {},
    options: IterationOptions<T> = {},
  ): AsyncGenerator<R> {
    const maximum = Math.min(
      this.bounded(options.maximum ?? 10000, 1000000),
      options.limit === undefined
        ? 1000000
        : this.bounded(options.limit, 1000000),
    );
    const query = this.model
      .find(this.filter(filter))
      .select(this.projection(options))
      .sort(this.sort(options, true))
      .collation({ locale: 'simple' })
      .limit(maximum)
      .session(this.session(options) ?? null);
    if (options.populate)
      query.populate(this.population(options.populate, options));
    const cursor = query
      .lean<R[]>()
      .cursor({ batchSize: this.bounded(options.batchSize ?? 100, 1000) });
    try {
      for await (const row of cursor) yield row;
    } finally {
      await cursor.close();
    }
  }
  aggregate<R extends object>(
    pipeline: readonly PipelineStage[],
    options: Omit<AggregateOptions, 'session'> & Write = {},
  ): Promise<R[]> {
    const { ...native } = options;
    delete native.context;
    delete native.allowAll;
    return this.model
      .aggregate<R>([...pipeline], {
        ...native,
        session: this.session(options),
      })
      .exec();
  }
  /** Native bulk semantics: validation for inserts/replacements; no per-document save/update hooks. */
  async bulkWrite(
    operations: readonly AnyBulkWriteOperation<Native<T>>[],
    options: Pick<MongooseBulkWriteOptions, 'ordered'> & Write = {},
  ): Promise<RepositoryBulkResult> {
    this.bounded(operations.length, 1000, 'INVALID_BATCH_SIZE');
    const normalized = operations.map(
      (operation): AnyBulkWriteOperation<Native<T>> => {
        if ('insertOne' in operation) {
          const document = operation.insertOne.document;
          if (!document.id || (document._id && document._id !== document.id))
            throw new ApplicationError('INVALID_REPOSITORY_INPUT', 400);
          return {
            insertOne: {
              ...operation.insertOne,
              skipValidation: false,
              document: { ...document, _id: document.id } as typeof document,
            },
          };
        }
        if ('replaceOne' in operation) {
          const entry = operation.replaceOne,
            replacement = entry.replacement;
          if (entry.upsert)
            throw new ApplicationError('USE_EXPLICIT_UPSERT', 400);
          if (
            !replacement.id ||
            (entry.filter.id ?? entry.filter._id) !== replacement.id
          )
            throw new ApplicationError('BULK_REPLACEMENT_ID_REQUIRED', 400);
          return {
            replaceOne: {
              ...entry,
              skipValidation: false,
              filter: this.filter(entry.filter),
              replacement: {
                ...replacement,
                _id: replacement.id,
              } as typeof replacement,
            },
          };
        }
        if ('updateOne' in operation || 'updateMany' in operation) {
          const entry =
            'updateOne' in operation
              ? operation.updateOne
              : operation.updateMany;
          if (entry.upsert)
            throw new ApplicationError('USE_EXPLICIT_UPSERT', 400);
          this.guardFilter(entry.filter, options);
          this.guardUpdate(entry.update);
          const normalized = { ...entry, filter: this.filter(entry.filter) };
          return 'updateOne' in operation
            ? { updateOne: normalized }
            : { updateMany: normalized };
        }
        const entry =
          'deleteOne' in operation ? operation.deleteOne : operation.deleteMany;
        this.guardFilter(entry.filter, options);
        return 'deleteOne' in operation
          ? { deleteOne: { ...entry, filter: this.filter(entry.filter) } }
          : { deleteMany: { ...entry, filter: this.filter(entry.filter) } };
      },
    );
    // Preserve native errors/results: unordered or server failures may contain partial outcomes.
    // Mongoose's conditional DocContents generic does not reduce for the abstract T.
    // Pin only that library boundary to the same native operation/result types;
    // all input operations remain typed and validated above (no erased generic).
    const execute = this.model.bulkWrite.bind(this.model) as (
      operations: AnyBulkWriteOperation<Native<T>>[],
      options: MongooseBulkWriteOptions,
    ) => ReturnType<Model<Native<T>>['bulkWrite']>;
    const result = await execute(normalized, {
      ordered: options.ordered ?? true,
      session: this.session(options),
      skipValidation: false,
      throwOnValidationError: true,
    });
    return {
      insertedCount: result.insertedCount,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      deletedCount: result.deletedCount,
      upsertedCount: result.upsertedCount,
    };
  }
}

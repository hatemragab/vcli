import { asc, sql, type SQL } from 'drizzle-orm';
import type { PostgresDatabase } from './postgres-database.js';
import type { TransactionContext } from './transaction-context.js';
import type {
  BulkOptions,
  IterateOptions,
  PaginatedResult,
  PaginationOptions,
  PostgresRepositorySchema,
  ReadOptions,
  RepositoryEntity,
  RepositoryOptions,
  UpsertOptions,
  WriteSummary,
} from './repository-types.js';
import { ApplicationError } from '../errors/application-error.js';

/** Internal PostgreSQL capability. Feature services retain authorization and invariants. */
export abstract class BaseRepository<T extends RepositoryEntity> {
  protected constructor(
    protected readonly database: PostgresDatabase,
    protected readonly schema: PostgresRepositorySchema<T>,
  ) {}

  /** Native Drizzle database for specialized feature queries and joins. */
  protected get db() {
    return this.database.db;
  }
  protected get columns() {
    return this.schema.columns;
  }

  private run<R>(
    context: TransactionContext | undefined,
    work: (context: TransactionContext) => Promise<R>,
  ): Promise<R> {
    return context ? work(context) : this.database.run(work);
  }
  private bound(value: number, maximum = 1000): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new ApplicationError('INVALID_REPOSITORY_LIMIT', 400);
    return value;
  }
  private keys(values: object, update = false): (keyof T & string)[] {
    const keys = Object.keys(values) as (keyof T & string)[];
    for (const key of keys) {
      const value: unknown = (values as Record<string, unknown>)[key];
      if (
        !Object.hasOwn(this.columns, key) ||
        (update && key === 'id') ||
        value === undefined ||
        typeof value === 'function' ||
        typeof value === 'symbol' ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        (value instanceof Date && !Number.isFinite(value.getTime()))
      )
        throw new ApplicationError('INVALID_REPOSITORY_INPUT', 400);
    }
    return keys;
  }
  private validateEntity(entity: T): void {
    if (
      this.keys(entity).length !== Object.keys(this.columns).length ||
      typeof entity.id !== 'string' ||
      !entity.id
    )
      throw new ApplicationError('INVALID_REPOSITORY_INPUT', 400);
  }
  private projection<K extends keyof T>(fields?: readonly K[]): SQL {
    const keys = fields ?? (Object.keys(this.columns) as (keyof T & string)[]);
    if (!keys.length || keys.some((key) => !Object.hasOwn(this.columns, key)))
      throw new ApplicationError('INVALID_REPOSITORY_PROJECTION', 400);
    return sql.join(
      keys.map(
        (key) => sql`${this.columns[key]} AS ${sql.identifier(String(key))}`,
      ),
      sql`, `,
    );
  }
  private decodeValue<K extends keyof T>(key: K, value: unknown): T[K] {
    // The owner-defined PgColumn is the native runtime codec for T[K]. This is
    // the single generic result boundary, rather than a scalar/JSON query DSL.
    return (
      value === null ? null : this.columns[key].mapFromDriverValue(value)
    ) as T[K];
  }
  private decode<K extends keyof T = keyof T>(
    row: Record<string, unknown>,
    fields?: readonly K[],
  ): Pick<T, K> {
    const keys = fields ?? (Object.keys(this.columns) as (keyof T & string)[]);
    return Object.fromEntries(
      keys.map((key) => [key, this.decodeValue(key, row[String(key)])]),
    ) as Pick<T, K>;
  }

  private order(orderBy: readonly SQL[] = []): SQL {
    return sql.join([...orderBy, asc(this.columns.id)], sql`, `);
  }
  private condition(where: SQL | undefined): SQL {
    return where?.queryChunks.length ? where : sql`TRUE`;
  }
  private requireBulkCondition(
    where: SQL | undefined,
    options: BulkOptions,
  ): void {
    if ((!where || !where.queryChunks.length) && options.allowAll !== true)
      throw new ApplicationError('UNSCOPED_BULK_WRITE', 400);
  }
  private assignments(changes: Partial<Omit<T, 'id'>>): SQL {
    const keys = this.keys(changes, true);
    if (!keys.length)
      throw new ApplicationError('EMPTY_REPOSITORY_UPDATE', 400);
    // Only owner-defined columns form identifiers; every input value is parameterized.
    return sql.join(
      keys.map(
        (key) =>
          sql`${sql.identifier(this.columns[key].name)} = ${sql.param(changes[key as keyof typeof changes], this.columns[key])}`,
      ),
      sql`, `,
    );
  }
  private async selected<K extends keyof T>(
    where: SQL | undefined,
    options: ReadOptions<T, K>,
    offset = 0,
  ): Promise<Pick<T, K>[]> {
    const limit = this.bound(options.limit ?? 100);
    if (options.lock && !options.context)
      throw new ApplicationError('LOCK_REQUIRES_TRANSACTION', 400);
    const lock =
      options.lock === 'update'
        ? sql`FOR UPDATE`
        : options.lock === 'share'
          ? sql`FOR SHARE`
          : sql``;
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute<Record<string, unknown>>(
          sql`SELECT ${this.projection(options.fields)} FROM ${this.schema.table} WHERE ${this.condition(where)} ORDER BY ${this.order(options.orderBy)} LIMIT ${limit} OFFSET ${offset} ${lock}`,
        );
      return result.rows.map((row) => this.decode(row, options.fields));
    });
  }
  create(entity: T, options: RepositoryOptions = {}): Promise<T> {
    return this.createMany([entity], options).then((rows) => rows[0]!);
  }
  /** Batches up to 1000 records atomically; SQL constraints apply, no ORM save hooks. */
  async createMany(
    entities: readonly T[],
    options: RepositoryOptions = {},
  ): Promise<T[]> {
    if (entities.length > 1000)
      throw new ApplicationError('INVALID_REPOSITORY_LIMIT', 400);
    for (const entity of entities) this.validateEntity(entity);
    if (!entities.length) return [];
    return this.run(options.context, async (context) => {
      const keys = Object.keys(this.columns) as (keyof T & string)[];
      const rows: T[] = [];
      for (let offset = 0; offset < entities.length; offset += 100) {
        const result = await this.database
          .context(context)
          .execute<Record<string, unknown>>(
            sql`INSERT INTO ${this.schema.table} (${sql.join(
              keys.map((key) => sql.identifier(this.columns[key].name)),
              sql`,`,
            )}) VALUES ${sql.join(
              entities.slice(offset, offset + 100).map(
                (entity) =>
                  sql`(${sql.join(
                    keys.map(
                      (key) =>
                        sql`${sql.param(entity[key], this.columns[key])}`,
                    ),
                    sql`,`,
                  )})`,
              ),
              sql`,`,
            )} RETURNING ${this.projection()}`,
          );
        rows.push(...result.rows.map((row) => this.decode(row)));
      }
      // Native RETURNING order is unspecified; return the actual decoded records.
      return rows;
    });
  }
  findById<K extends keyof T = keyof T>(
    id: string,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K> | null> {
    return this.findOne(sql`${this.columns.id} = ${id}`, options);
  }
  async findByIdOrThrow<K extends keyof T = keyof T>(
    id: string,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K>> {
    const row = await this.findById(id, options);
    if (!row) throw new ApplicationError('RECORD_NOT_FOUND', 404);
    return row;
  }
  async findOne<K extends keyof T = keyof T>(
    where: SQL,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K> | null> {
    return (await this.selected(where, { ...options, limit: 1 }))[0] ?? null;
  }
  async findOneOrThrow<K extends keyof T = keyof T>(
    where: SQL,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K>> {
    const row = await this.findOne(where, options);
    if (!row) throw new ApplicationError('RECORD_NOT_FOUND', 404);
    return row;
  }
  findMany<K extends keyof T = keyof T>(
    where?: SQL,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K>[]> {
    return this.selected(where, options);
  }
  exists(where: SQL, options: RepositoryOptions = {}): Promise<boolean> {
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute<{ exists: boolean }>(
          sql`SELECT EXISTS(SELECT 1 FROM ${this.schema.table} WHERE ${where}) AS exists`,
        );
      return result.rows[0]!.exists;
    });
  }
  count(where?: SQL, options: RepositoryOptions = {}): Promise<number> {
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute<{ count: string }>(
          sql`SELECT count(*) AS count FROM ${this.schema.table} WHERE ${this.condition(where)}`,
        );
      const count = Number(result.rows[0]!.count);
      if (!Number.isSafeInteger(count))
        throw new ApplicationError('COUNT_OUT_OF_RANGE', 500);
      return count;
    });
  }
  distinct<K extends keyof T>(
    field: K,
    where?: SQL,
    options: RepositoryOptions & { limit?: number } = {},
  ): Promise<T[K][]> {
    if (!Object.hasOwn(this.columns, field))
      throw new ApplicationError('INVALID_REPOSITORY_PROJECTION', 400);
    const limit = this.bound(options.limit ?? 100);
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute<Record<string, unknown>>(
          sql`SELECT DISTINCT ${this.columns[field]} AS value FROM ${this.schema.table} WHERE ${this.condition(where)} ORDER BY value ASC NULLS LAST LIMIT ${limit}`,
        );
      return result.rows.map((row) => this.decodeValue(field, row.value));
    });
  }
  findWithPagination<K extends keyof T = keyof T>(
    options: PaginationOptions<T, K> = {},
    where?: SQL,
  ): Promise<PaginatedResult<Pick<T, K>>> {
    const page = options.page ?? 1,
      limit = options.limit ?? 20;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (page - 1) * limit > 1000000
    )
      throw new ApplicationError('INVALID_PAGINATION', 400);
    return this.run(options.context, async (context) => {
      const data = await this.selected(
        where,
        { ...options, context, limit },
        (page - 1) * limit,
      );
      const totalCount = await this.count(where, { context }),
        totalPages = Math.ceil(totalCount / limit);
      return {
        data,
        totalCount,
        totalPages,
        currentPage: page,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      };
    });
  }
  /** Atomically chooses and locks one row using the same stable sort as reads. */
  private mutateOne<K extends keyof T>(
    kind: 'update' | 'delete',
    where: SQL,
    changes: Partial<Omit<T, 'id'>>,
    options: ReadOptions<T, K>,
  ): Promise<Pick<T, K> | null> {
    const assignments =
      kind === 'update' ? this.assignments(changes) : undefined;
    return this.run(options.context, async (context) => {
      const chosen = sql`SELECT ${this.columns.id} FROM ${this.schema.table} WHERE ${where} ORDER BY ${this.order(options.orderBy)} LIMIT 1 FOR UPDATE`;
      const statement =
        kind === 'update'
          ? sql`UPDATE ${this.schema.table} SET ${assignments} WHERE ${this.columns.id} = (${chosen}) RETURNING ${this.projection(options.fields)}`
          : sql`DELETE FROM ${this.schema.table} WHERE ${this.columns.id} = (${chosen}) RETURNING ${this.projection(options.fields)}`;
      const result = await this.database
        .context(context)
        .execute<Record<string, unknown>>(statement);
      return result.rows[0]
        ? this.decode(result.rows[0], options.fields)
        : null;
    });
  }
  async updateOne(
    where: SQL,
    changes: Partial<Omit<T, 'id'>>,
    options: RepositoryOptions = {},
  ): Promise<WriteSummary> {
    return {
      affectedCount: (await this.findOneAndUpdate(where, changes, {
        ...options,
        fields: ['id'],
      }))
        ? 1
        : 0,
    };
  }
  updateMany(
    where: SQL | undefined,
    changes: Partial<Omit<T, 'id'>>,
    options: BulkOptions = {},
  ): Promise<WriteSummary> {
    this.requireBulkCondition(where, options);
    const assignments = this.assignments(changes);
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute(
          sql`UPDATE ${this.schema.table} SET ${assignments} WHERE ${this.condition(where)}`,
        );
      return { affectedCount: result.rowCount ?? 0 };
    });
  }
  findByIdAndUpdate<K extends keyof T = keyof T>(
    id: string,
    changes: Partial<Omit<T, 'id'>>,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K> | null> {
    return this.findOneAndUpdate(
      sql`${this.columns.id} = ${id}`,
      changes,
      options,
    );
  }
  findOneAndUpdate<K extends keyof T = keyof T>(
    where: SQL,
    changes: Partial<Omit<T, 'id'>>,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K> | null> {
    return this.mutateOne('update', where, changes, options);
  }
  /** Atomic INSERT ON CONFLICT; returns null when updateWhere rejects the update. */
  upsert<K extends keyof T = keyof T>(
    entity: T,
    options: UpsertOptions<T, K>,
  ): Promise<Pick<T, K> | null> {
    this.validateEntity(entity);
    if (
      !options.conflictTarget.length ||
      !this.schema.conflictTargets.some(
        (target) =>
          target.length === options.conflictTarget.length &&
          target.every((key, i) => key === options.conflictTarget[i]),
      )
    )
      throw new ApplicationError('INVALID_CONFLICT_TARGET', 400);
    const keys = Object.keys(this.columns) as (keyof T & string)[],
      assignments = this.assignments(options.set);
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute<Record<string, unknown>>(
          sql`INSERT INTO ${this.schema.table} (${sql.join(
            keys.map((key) => sql.identifier(this.columns[key].name)),
            sql`,`,
          )}) VALUES (${sql.join(
            keys.map(
              (key) => sql`${sql.param(entity[key], this.columns[key])}`,
            ),
            sql`,`,
          )}) ON CONFLICT (${sql.join(
            options.conflictTarget.map((key) =>
              sql.identifier(this.columns[key].name),
            ),
            sql`,`,
          )}) DO UPDATE SET ${assignments} WHERE ${this.condition(options.updateWhere)} RETURNING ${this.projection(options.fields)}`,
        );
      return result.rows[0]
        ? this.decode(result.rows[0], options.fields)
        : null;
    });
  }
  async deleteOne(
    where: SQL,
    options: RepositoryOptions = {},
  ): Promise<WriteSummary> {
    return {
      affectedCount: (await this.findOneAndDelete(where, {
        ...options,
        fields: ['id'],
      }))
        ? 1
        : 0,
    };
  }
  deleteMany(where?: SQL, options: BulkOptions = {}): Promise<WriteSummary> {
    this.requireBulkCondition(where, options);
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute(
          sql`DELETE FROM ${this.schema.table} WHERE ${this.condition(where)}`,
        );
      return { affectedCount: result.rowCount ?? 0 };
    });
  }
  findByIdAndDelete<K extends keyof T = keyof T>(
    id: string,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K> | null> {
    return this.findOneAndDelete(sql`${this.columns.id} = ${id}`, options);
  }
  findOneAndDelete<K extends keyof T = keyof T>(
    where: SQL,
    options: ReadOptions<T, K> = {},
  ): Promise<Pick<T, K> | null> {
    return this.mutateOne('delete', where, {}, options);
  }
  /** Native SELECT for typed joins/grouping; outer limit bounds transfer and buffering. */
  protected queryRows<R extends Record<string, unknown>>(
    statement: SQL<R>,
    options: RepositoryOptions & { limit?: number } = {},
  ): Promise<R[]> {
    const limit = this.bound(options.limit ?? 100);
    return this.run(options.context, async (context) => {
      const result = await this.database
        .context(context)
        .execute<Record<string, unknown>>(
          sql`SELECT * FROM (${statement}) AS repository_query LIMIT ${limit}`,
        );
      // SQL<R> is the trusted feature owner's result contract. Raw SQL output
      // uses pg driver values; the feature owns any expression-specific mapping.
      return result.rows as R[];
    });
  }

  /** ID keyset traversal. A current transaction must remain active while consuming it. */
  async *iterate<K extends keyof T = keyof T>(
    where: SQL | undefined,
    options: IterateOptions<T, K>,
  ): AsyncGenerator<Pick<T, K>> {
    const maxRows = this.bound(options.maxRows, 1000000),
      batchSize = this.bound(options.batchSize ?? 100);
    let after: string | undefined,
      emitted = 0;
    while (emitted < maxRows) {
      const limit = Math.min(batchSize, maxRows - emitted);
      const rows = await this.run(options.context, async (context) => {
        const result = await this.database
          .context(context)
          .execute<Record<string, unknown>>(
            sql`SELECT ${this.projection(options.fields ? [...new Set<keyof T>([...options.fields, 'id'])] : undefined)} FROM ${this.schema.table} WHERE (${this.condition(where)}) AND (${after === undefined ? sql`TRUE` : sql`${this.columns.id} > ${after}`}) ORDER BY ${this.columns.id} ASC LIMIT ${limit}`,
          );
        return result.rows;
      });
      for (const row of rows) {
        after = this.decodeValue('id', row.id);
        emitted++;
        yield this.decode(row, options.fields);
      }
      if (rows.length < limit) break;
    }
  }
}

import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { TransactionContext } from './transaction-context.js';

export type RepositoryEntity = Readonly<{ id: string }>;
/** Static feature-owner schema; never constructed from HTTP input. */
export type PostgresRepositorySchema<T extends RepositoryEntity> = Readonly<{
  table: PgTable;
  columns: {
    readonly [K in keyof T]: PgColumn & {
      readonly _: { readonly data: NonNullable<T[K]> };
    };
  };
  /** Exact non-partial unique constraints allowed as ON CONFLICT targets. */
  conflictTargets: readonly (readonly (keyof T & string)[])[];
}>;
export type RepositoryOptions = Readonly<{ context?: TransactionContext }>;
export type ReadOptions<T, K extends keyof T = keyof T> = RepositoryOptions &
  Readonly<{
    fields?: readonly K[];
    /** Native owner-authored expressions; the unique id is appended as a tie-breaker. */
    orderBy?: readonly SQL[];
    limit?: number;
    /** Lock is valid only inside a caller-owned active transaction. */
    lock?: 'update' | 'share';
  }>;
export type PaginationOptions<T, K extends keyof T = keyof T> = Omit<
  ReadOptions<T, K>,
  'limit'
> &
  Readonly<{ page?: number; limit?: number }>;
export type PaginatedResult<T> = Readonly<{
  data: T[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}>;
/** PostgreSQL affected rows, including matched rows whose values were unchanged. */
export type WriteSummary = Readonly<{ affectedCount: number }>;
export type BulkOptions = RepositoryOptions & Readonly<{ allowAll?: boolean }>;
export type IterateOptions<T, K extends keyof T = keyof T> = RepositoryOptions &
  Readonly<{ fields?: readonly K[]; batchSize?: number; maxRows: number }>;
export type UpsertOptions<
  T extends RepositoryEntity,
  K extends keyof T = keyof T,
> = ReadOptions<T, K> &
  Readonly<{
    conflictTarget: readonly (keyof T & string)[];
    /** Explicit replacement values; id is immutable even on conflict. */
    set: Partial<Omit<T, 'id'>>;
    /** Native WHERE condition on the conflict update, e.g. a version fence. */
    updateWhere?: SQL;
  }>;

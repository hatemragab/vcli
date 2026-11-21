import type {
  ClientSession,
  PopulateOptions,
  ProjectionType,
  QueryFilter,
  SortOrder,
} from 'mongoose';
import type { TransactionContext } from './transaction-context.js';
export type RepositoryEntity = Readonly<{
  id: string;
}>;
export type RepositoryDocument<T extends RepositoryEntity> = T & {
  _id: string;
};
export type RepositoryFilter<T extends RepositoryEntity> = QueryFilter<
  RepositoryDocument<T>
>;
export type RepositoryWriteOptions = Readonly<{
  context?: TransactionContext;
  session?: ClientSession;
  allowAll?: boolean;
}>;
export type RepositoryReadOptions<T extends RepositoryEntity> =
  RepositoryWriteOptions &
    Readonly<{
      projection?: never;
      populate?: never;
      sort?: Partial<Record<keyof T, SortOrder>> & Record<string, SortOrder>;
      limit?: number;
    }>;
/** Supplying projection/population makes the result a caller-declared view, with honest partial/unknown defaults unless a result view is declared. */
export type RepositoryViewOptions<T extends RepositoryEntity> = Omit<
  RepositoryReadOptions<T>,
  'projection' | 'populate'
> &
  Readonly<{
    projection?: ProjectionType<RepositoryDocument<T>>;
    populate?: PopulateOptions | PopulateOptions[];
  }>;
export type PaginationOptions = Readonly<{
  page?: number;
  limit?: number;
}>;
export type PaginatedResult<T> = Readonly<{
  data: T[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}>;
export type IterationOptions<T extends RepositoryEntity> =
  RepositoryViewOptions<T> &
    Readonly<{
      batchSize?: number;
      maximum?: number;
    }>;

/** Plain bulk summary; all inserted IDs are supplied explicitly by the caller. */
export type RepositoryBulkResult = Readonly<{
  insertedCount: number;
  matchedCount: number;
  modifiedCount: number;
  deletedCount: number;
  upsertedCount: number;
}>;

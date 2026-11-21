import { getTableColumns } from 'drizzle-orm';
import {
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { BaseRepository } from '../../dist/core/database/base-repository.js';
import type { PostgresDatabase } from '../../dist/core/database/postgres-database.js';

export const nativeValuesTable = pgTable('repository_native_values', {
  id: uuid('id').primaryKey(),
  metadata: jsonb('metadata')
    .$type<{ tags: string[]; nested: { enabled: boolean } }>()
    .notNull(),
  occurredAt: timestamp('occurred_at', {
    withTimezone: true,
    mode: 'date',
  }).notNull(),
  labels: text('labels').array().notNull(),
  visits: bigint('visits', { mode: 'bigint' }).notNull(),
});
export type NativeValues = typeof nativeValuesTable.$inferSelect;

export class NativeValuesRepository extends BaseRepository<NativeValues> {
  constructor(database: PostgresDatabase) {
    super(database, {
      table: nativeValuesTable,
      columns: getTableColumns(nativeValuesTable),
      conflictTargets: [['id']],
    });
  }
}

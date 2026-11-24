import { bigint, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { getTableColumns } from 'drizzle-orm';
import type { PostgresRepositorySchema } from '../../core/database/repository-types.js';
import type { Note } from './notes-input.js';
export type { Note } from './notes-input.js';
export const noteTable = pgTable('app_notes', {
  id: uuid('id').primaryKey(),
  ownerId: uuid('owner_id').notNull(),
  title: varchar('title', { length: 120 }).notNull(),
  body: text('body').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});
export const noteRepository: PostgresRepositorySchema<Note> = {
  table: noteTable,
  columns: getTableColumns(noteTable),
  conflictTargets: [['id']],
};

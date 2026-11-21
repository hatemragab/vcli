import { bigint, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { getTableColumns } from 'drizzle-orm';
import type { PostgresRepositorySchema } from '../../core/database/repository-types.js';
import { ApplicationError } from '../../core/errors/application-error.js';
export type Note = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  body: string;
  createdAt: number;
}>;

export const noteTable = pgTable('reference_notes', {
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
export function validateNote(note: Note): Note {
  if (
    !note.id ||
    !note.ownerId ||
    !note.title.trim() ||
    note.title.length > 120 ||
    note.body.length > 10000 ||
    !Number.isSafeInteger(note.createdAt) ||
    note.createdAt < 0
  )
    throw new ApplicationError('INVALID_NOTE', 400);
  return Object.freeze({ ...note });
}

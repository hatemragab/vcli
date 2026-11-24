import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { EventPublisher } from '../../core/realtime/event-publisher.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  noteRepository,
  noteTable,
  validateNote,
  type Note,
} from './notes.entity.js';
@Injectable()
export class NotesService extends BaseRepository<Note> {
  constructor(
    database: PostgresDatabase,
    private readonly publisher: EventPublisher,
  ) {
    super(database, noteRepository);
  }
  async createOwned(note: Note, eventId: string) {
    const validated = validateNote(note);
    await this.database.run(async (context) => {
      await this.create(validated, { context });
    });
    const notification = await this.publisher.publish(validated.ownerId, {
      id: eventId,
      type: 'notes.created',
      payload: { noteId: validated.id },
    });
    return { note: validated, notification };
  }
  async getOwned(ownerId: string, noteId: string): Promise<Note> {
    const note = await this.findOne(
      and(eq(noteTable.id, noteId), eq(noteTable.ownerId, ownerId))!,
    );
    if (!note) throw new ApplicationError('NOTE_NOT_FOUND', 404);
    return note;
  }
  async listOwned(ownerId: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApplicationError('INVALID_LIMIT', 400);
    const rows = await this.database.run(async (context): Promise<Note[]> => {
      const database = this.database;
      const result = await database.context(context).execute<{
        data: Note;
      }>(sql`SELECT json_build_object('id',id,'ownerId',owner_id,'title',title,'body',body,'createdAt',created_at) AS data FROM reference_notes WHERE owner_id=${ownerId} ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`);
      return result.rows.map((row) => row.data);
    });
    return { items: rows.slice(0, limit), truncated: rows.length > limit };
  }
  async initializeSchema(): Promise<void> {
    const database = this.database;
    await database.run(async (context) => {
      const transaction = database.context(context);
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('vcli-reference-notes-v1'))`,
      );
      await transaction.execute(
        sql`CREATE TABLE IF NOT EXISTS reference_notes (id uuid PRIMARY KEY, owner_id uuid NOT NULL, title varchar(120) NOT NULL CHECK (length(title) > 0), body text NOT NULL CHECK (length(body) <= 10000), created_at bigint NOT NULL CHECK (created_at >= 0))`,
      );
      await transaction.execute(
        sql`CREATE INDEX IF NOT EXISTS reference_notes_owner_created ON reference_notes (owner_id, created_at DESC, id DESC)`,
      );
    });
  }
}

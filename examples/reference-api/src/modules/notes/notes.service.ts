import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { EventPublisher } from '../../core/realtime/event-publisher.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  noteMongoValidator,
  noteSchema,
  validateNote,
  type Note,
} from './notes.entity.js';

@Injectable()
export class NotesService extends BaseRepository<Note> {
  constructor(
    database: MongoDatabase,
    private readonly publisher: EventPublisher,
  ) {
    super(database, 'ReferenceNote', noteSchema, 'NOTE_CONFLICT');
  }
  async createOwned(note: Note, eventId: string) {
    const validated = validateNote(note);
    await this.create(validated);
    const notification = await this.publisher.publish(validated.ownerId, {
      id: eventId,
      type: 'notes.created',
      payload: { noteId: validated.id },
    });
    return { note: validated, notification };
  }
  async getOwned(ownerId: string, noteId: string): Promise<Note> {
    const note = await this.findOne({ id: noteId, ownerId });
    if (!note) throw new ApplicationError('NOTE_NOT_FOUND', 404);
    return note;
  }
  async listOwned(ownerId: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApplicationError('INVALID_LIMIT', 400);
    const rows = await this.findMany(
      { ownerId },
      { sort: { createdAt: -1, _id: -1 }, limit: limit + 1 },
    );
    return { items: rows.slice(0, limit), truncated: rows.length > limit };
  }
  async initializeSchema(): Promise<void> {
    await this.model.createCollection();
    const db = this.database.connection.db!;
    await db.command({
      collMod: 'reference_notes',
      validator: noteMongoValidator(false),
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await db
      .collection('reference_notes')
      .updateMany({ id: { $exists: false } }, [{ $set: { id: '$_id' } }]);
    await db.command({
      collMod: 'reference_notes',
      validator: noteMongoValidator(true),
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await this.model.createIndexes();
  }
}

import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { EventPublisher } from '../../core/realtime/event-publisher.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  noteIdSchema,
  safeNote,
  validateNote,
  type Note,
  type NoteDraft,
} from './notes-input.js';
import { assertNotesPrincipal } from './notes-authority.js';
import {
  publishNoteHint,
  type CreateNoteResult,
  type NotesPage,
} from './notes-result.js';
import { noteSchema } from './notes.entity.js';

@Injectable()
export class NotesService extends BaseRepository<Note> {
  constructor(
    database: MongoDatabase,
    private readonly authority: PrincipalAuthority,
    private readonly publisher?: EventPublisher,
  ) {
    super(database, 'AppNote', noteSchema, 'NOTE_CONFLICT');
  }
  async createOwned(
    principal: Principal,
    draft: NoteDraft,
    eventId: string,
  ): Promise<CreateNoteResult> {
    const validated = validateNote({ ...draft, ownerId: principal.accountId });
    if (!noteIdSchema.safeParse(eventId).success)
      throw new ApplicationError('INVALID_NOTE', 400);
    await assertNotesPrincipal(this.authority, principal);
    // Native repository awaits the write/commit; external publication is never in a retry callback.
    await this.create(validated);
    const notification = await publishNoteHint(
      validated,
      eventId,
      this.publisher,
    );
    return { note: safeNote(validated), notification };
  }
  async getOwned(principal: Principal, noteId: string): Promise<Note> {
    if (!noteIdSchema.safeParse(noteId).success)
      throw new ApplicationError('INVALID_NOTE', 400);
    await assertNotesPrincipal(this.authority, principal);
    const note = await this.findOne({
      id: noteId,
      ownerId: principal.accountId,
    });
    if (!note) throw new ApplicationError('NOTE_NOT_FOUND', 404);
    return safeNote(note);
  }
  async listOwned(principal: Principal, limit = 20): Promise<NotesPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApplicationError('INVALID_LIMIT', 400);
    await assertNotesPrincipal(this.authority, principal);
    const rows = await this.findMany(
      { ownerId: principal.accountId },
      { sort: { createdAt: -1, id: -1 }, limit: limit + 1 },
    );
    return {
      items: rows.slice(0, limit).map(safeNote),
      truncated: rows.length > limit,
    };
  }
}

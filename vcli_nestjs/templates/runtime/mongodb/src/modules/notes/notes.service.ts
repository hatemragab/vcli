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
  validateNoteEdit,
  type Note,
  type NoteDraft,
  type NoteEdit,
} from './notes-input.js';
import { assertNotesPrincipal } from './notes-authority.js';
// vcli:notes-media:start
import { assertNoteImage, type NoteImageSource } from './notes-image.js';
// vcli:notes-media:end
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
    // vcli:notes-media:start
    private readonly images?: NoteImageSource,
    // vcli:notes-media:end
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
    // vcli:notes-media:start
    if (validated.imageId)
      await this.requireImage(principal, validated.imageId);
    // vcli:notes-media:end
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
  async editOwned(
    principal: Principal,
    noteId: string,
    input: NoteEdit,
  ): Promise<Note> {
    if (!noteIdSchema.safeParse(noteId).success)
      throw new ApplicationError('INVALID_NOTE', 400);
    const patch = validateNoteEdit(input);
    // vcli:notes-media:start
    if (patch.imageId) {
      await this.getOwned(principal, noteId);
      await this.requireImage(principal, patch.imageId);
    }
    // vcli:notes-media:end
    await assertNotesPrincipal(this.authority, principal);
    const note = await this.findOneAndUpdate(
      { id: noteId, ownerId: principal.accountId },
      { $set: patch },
    );
    if (!note) throw new ApplicationError('NOTE_NOT_FOUND', 404);
    return safeNote(note);
  }
  async removeOwned(principal: Principal, noteId: string): Promise<void> {
    if (!noteIdSchema.safeParse(noteId).success)
      throw new ApplicationError('INVALID_NOTE', 400);
    await assertNotesPrincipal(this.authority, principal);
    const result = await this.deleteOne({
      id: noteId,
      ownerId: principal.accountId,
    });
    if (result.deletedCount !== 1)
      throw new ApplicationError('NOTE_NOT_FOUND', 404);
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
  // vcli:notes-media:start
  private requireImage(principal: Principal, imageId: string): Promise<void> {
    if (!this.images) throw new ApplicationError('NOTE_IMAGE_UNAVAILABLE', 503);
    return assertNoteImage(this.images, principal, imageId);
  }
  // vcli:notes-media:end
}

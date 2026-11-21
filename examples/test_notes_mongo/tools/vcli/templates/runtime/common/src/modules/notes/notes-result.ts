import type {
  EventPublisher,
  PublicationOutcome,
} from '../../core/realtime/event-publisher.js';
import type { Note } from './notes-input.js';

export type NoteNotification = Readonly<{
  status: PublicationOutcome['status'];
  transport?: PublicationOutcome['transport'];
}>;
export type CreateNoteResult = Readonly<{
  note: Note;
  notification: NoteNotification;
}>;
export type NotesPage = Readonly<{
  items: readonly Note[];
  truncated: boolean;
}>;
/** Called once, only after persistence. Unknown must never trigger an implicit HTTP retry. */
export async function publishNoteHint(
  note: Note,
  eventId: string,
  publisher?: EventPublisher,
): Promise<NoteNotification> {
  if (!publisher) return { status: 'unavailable' };
  try {
    const outcome = await publisher.publish(note.ownerId, {
      id: eventId,
      type: 'notes.created',
      payload: { noteId: note.id },
    });
    if (
      ![
        'attempted',
        'provider-accepted',
        'audience-ineligible',
        'unavailable',
        'unknown',
      ].includes(outcome.status) ||
      !['socketio', 'ws', 'centrifugo'].includes(outcome.transport)
    )
      return { status: 'unknown' };
    return { status: outcome.status, transport: outcome.transport };
  } catch {
    // The provider may have accepted before throwing; the saved note remains successful.
    return { status: 'unknown' };
  }
}

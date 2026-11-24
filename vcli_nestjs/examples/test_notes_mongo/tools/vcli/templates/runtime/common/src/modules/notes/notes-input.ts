import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';

export const createNoteSchema = z.strictObject({
  // Preserve the reviewed reference's UTF-16 input bounds across Zod versions.
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => value.length <= 120),
  body: z
    .string()
    .max(10000)
    .refine((value) => value.length <= 10000)
    .default(''),
});
export const noteIdSchema = z.uuidv4();
export const notesQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional()
    .default(20),
});
export const noteDraftSchema = createNoteSchema.extend({
  id: noteIdSchema,
  createdAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
const noteSchema = noteDraftSchema.extend({ ownerId: z.uuid() });
export type NoteDraft = Readonly<z.output<typeof noteDraftSchema>>;
export type Note = Readonly<z.output<typeof noteSchema>>;
export function validateNote(note: Note): Note {
  const result = noteSchema.safeParse(note);
  if (!result.success) throw new ApplicationError('INVALID_NOTE', 400);
  return Object.freeze(result.data);
}
/** Explicit response mapping excludes native metadata and any later internal fields. */
export function safeNote(note: Note): Note {
  return {
    id: note.id,
    ownerId: note.ownerId,
    title: note.title,
    body: note.body,
    createdAt: note.createdAt,
  };
}

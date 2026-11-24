import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';

// Preserve UTF-16 input bounds across Zod versions.
const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => value.length <= 120);
const bodySchema = z
  .string()
  .max(10000)
  .refine((value) => value.length <= 10000);
export const noteIdSchema = z.uuidv4();
// vcli:notes-media:start
const imageIdSchema = noteIdSchema.nullable().optional();
// vcli:notes-media:end
export const createNoteSchema = z.strictObject({
  title: titleSchema,
  body: bodySchema.default(''),
  // vcli:notes-media:start
  imageId: imageIdSchema,
  // vcli:notes-media:end
});
export const editNoteSchema = z
  .strictObject({
    title: titleSchema.optional(),
    body: bodySchema.optional(),
    // vcli:notes-media:start
    imageId: imageIdSchema,
    // vcli:notes-media:end
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined));
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
export type NoteEdit = Readonly<z.output<typeof editNoteSchema>>;
export function validateNote(note: Note): Note {
  const result = noteSchema.safeParse(note);
  if (!result.success) throw new ApplicationError('INVALID_NOTE', 400);
  return Object.freeze(safeNote(result.data));
}
export function validateNoteEdit(input: NoteEdit): NoteEdit {
  const result = editNoteSchema.safeParse(input);
  if (!result.success) throw new ApplicationError('INVALID_NOTE', 400);
  // The parsed keys are known. Omit optional undefined values before updating.
  return Object.fromEntries(
    Object.entries(result.data).filter(([, value]) => value !== undefined),
  ) as NoteEdit;
}
/** Explicit response mapping excludes native metadata and any later internal fields. */
export function safeNote(note: Note): Note {
  return {
    id: note.id,
    ownerId: note.ownerId,
    title: note.title,
    body: note.body,
    // vcli:notes-media:start
    imageId: note.imageId ?? null,
    // vcli:notes-media:end
    createdAt: note.createdAt,
  };
}

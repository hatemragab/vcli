import { Schema } from 'mongoose';
import { ApplicationError } from '../../core/errors/application-error.js';
export type Note = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  body: string;
  createdAt: number;
}>;
export const noteSchema = new Schema<Note>(
  {
    id: { type: String, required: true },
    ownerId: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 10000 },
    createdAt: { type: Number, required: true },
  },
  {
    versionKey: false,
    collection: 'reference_notes',
    autoIndex: false,
    autoCreate: false,
  },
);
noteSchema.add(new Schema({ _id: String }));
noteSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });

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
/** Existing _id-only reference records are backfilled by explicit schema setup. */
export function noteMongoValidator(requireId: boolean) {
  return {
    $jsonSchema: {
      bsonType: 'object',
      required: [
        '_id',
        ...(requireId ? ['id'] : []),
        'ownerId',
        'title',
        'body',
        'createdAt',
      ],
      additionalProperties: false,
      properties: {
        _id: { bsonType: 'string' },
        id: { bsonType: 'string' },
        ownerId: { bsonType: 'string' },
        title: { bsonType: 'string', minLength: 1, maxLength: 120 },
        body: { bsonType: 'string', maxLength: 10000 },
        createdAt: {
          bsonType: ['int', 'long', 'double'],
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
    },
  };
}

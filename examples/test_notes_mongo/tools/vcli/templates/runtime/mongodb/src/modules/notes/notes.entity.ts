import { Schema } from 'mongoose';
import type { Note } from './notes-input.js';
export type { Note } from './notes-input.js';

export const noteSchema = new Schema<Note>(
  {
    id: {
      type: String,
      required: true,
      match:
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    },
    ownerId: { type: String, required: true },
    title: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 120,
      validate: (value: string) => value === value.trim(),
    },
    body: { type: String, default: '', maxlength: 10000 },
    createdAt: {
      type: Number,
      required: true,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      validate: Number.isSafeInteger,
    },
  },
  {
    collection: 'app_notes',
    versionKey: false,
    strict: 'throw',
    autoCreate: false,
    autoIndex: false,
  },
);
noteSchema.add(new Schema({ _id: String }));
noteSchema.index(
  { ownerId: 1, createdAt: -1, _id: -1 },
  { name: 'app_notes_owner_created' },
);
/** Fresh app namespace only; no reference record backfill or collection adoption. */
export const noteMongoValidator = {
  $and: [
    {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'id', 'ownerId', 'title', 'body', 'createdAt'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string' },
          id: {
            bsonType: 'string',
            pattern:
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          },
          ownerId: { bsonType: 'string', minLength: 1 },
          title: {
            bsonType: 'string',
            minLength: 1,
            maxLength: 120,
            pattern: '\\S',
          },
          body: { bsonType: 'string', maxLength: 10000 },
          createdAt: {
            bsonType: ['int', 'long', 'double'],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
            multipleOf: 1,
          },
        },
      },
    },
    { $expr: { $eq: ['$_id', '$id'] } },
  ],
};

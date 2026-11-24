import { z } from 'zod';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { ApplicationError } from '../../core/errors/application-error.js';

const collectionValidator = z.looseObject({
  $and: z.array(
    z.looseObject({
      $jsonSchema: z
        .looseObject({
          properties: z.record(z.string(), z.unknown()),
        })
        .optional(),
    }),
  ),
});
const imageIdRule = {
  bsonType: ['string', 'null'],
  pattern:
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
};

/** Add the optional field while preserving the current Notes validator. */
export async function initializeNotesImage(
  database: MongoDatabase,
): Promise<void> {
  const db = database.connection.db!;
  const collection = await db
    .listCollections({ name: 'app_notes' }, { nameOnly: false })
    .next();
  const parsed = collectionValidator.safeParse(collection?.options?.validator);
  if (!parsed.success || !parsed.data.$and.some((rule) => rule.$jsonSchema))
    throw new ApplicationError('NOTES_SCHEMA_NOT_INITIALIZED', 503);
  const validator = {
    ...parsed.data,
    $and: parsed.data.$and.map((rule) => {
      const schema = rule.$jsonSchema;
      return schema
        ? {
            ...rule,
            $jsonSchema: {
              ...schema,
              properties: { imageId: imageIdRule, ...schema.properties },
            },
          }
        : rule;
    }),
  };
  await db.command({ collMod: 'app_notes', validator });
}

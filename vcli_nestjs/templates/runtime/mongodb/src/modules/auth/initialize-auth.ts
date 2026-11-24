import { databaseErrorCode } from '../../core/database/database-errors.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { authAccountModel } from './auth.entity.js';

/** Apply the basic account schema during the selected release. */
export async function initializeAuth(database: MongoDatabase): Promise<void> {
  const accounts = authAccountModel(database.connection);
  const collection = accounts.collection.name;
  const db = database.connection.db!;
  // Preserve v1 validation for writes made directly against MongoDB.
  const validation = {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['_id', 'identifier', 'passwordHash', 'createdAt'],
        additionalProperties: false,
        properties: {
          _id: { bsonType: 'string', minLength: 1 },
          identifier: { bsonType: 'string', minLength: 1, maxLength: 254 },
          passwordHash: { bsonType: 'string', minLength: 1 },
          createdAt: {
            bsonType: ['int', 'long', 'double'],
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
            multipleOf: 1,
          },
        },
      },
    },
    validationLevel: 'strict',
    validationAction: 'error',
  } as const;
  try {
    await db.createCollection(collection, validation);
  } catch (error) {
    if (databaseErrorCode(error) !== 48) throw error;
    await db.command({ collMod: collection, ...validation });
  }
  await accounts.createIndexes();
}

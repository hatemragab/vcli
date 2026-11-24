import type { MongoDatabase } from '../../core/database/mongo-database.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { noteMongoValidator } from './notes.entity.js';

/** Explicit owner schema release, never ordinary application boot. */
export async function initializeNotes(database: MongoDatabase): Promise<void> {
  const db = database.connection.db!;
  if (!(await db.listCollections({ name: 'app_notes' }).hasNext())) {
    try {
      await db.createCollection('app_notes', {
        validator: noteMongoValidator,
        validationLevel: 'strict',
        validationAction: 'error',
      });
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 48
      )
        throw error;
    }
  }
  await db.command({
    collMod: 'app_notes',
    validator: noteMongoValidator,
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await db
    .collection('app_notes')
    .createIndex(
      { ownerId: 1, createdAt: -1, _id: -1 },
      { name: 'app_notes_owner_created' },
    );
}
export async function assertNotesInitialized(
  database: MongoDatabase,
): Promise<void> {
  if (
    !(await database.connection
      .db!.listCollections({ name: 'app_notes' })
      .hasNext())
  )
    throw new ApplicationError('NOTES_SCHEMA_NOT_INITIALIZED', 503);
}

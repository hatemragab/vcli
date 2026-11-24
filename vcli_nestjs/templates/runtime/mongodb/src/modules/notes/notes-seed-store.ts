import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { noteSchema, type Note } from './notes.entity.js';

export class NotesSeedStore extends BaseRepository<Note> {
  constructor(database: MongoDatabase) {
    super(database, 'AppNote', noteSchema);
  }

  async insertFixtures(
    fixtures: readonly Note[],
    context: TransactionContext,
  ): Promise<void> {
    // Keep native duplicate errors so the transaction can retry a concurrent insert.
    await this.model.insertMany(
      fixtures.map((note) => ({ ...note, _id: note.id })),
      { session: this.database.context(context) },
    );
  }
}

import { BaseRepository } from '../../core/database/base-repository.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { TransactionContext } from '../../core/database/transaction-context.js';
import { noteRepository, type Note } from './notes.entity.js';

export class NotesSeedStore extends BaseRepository<Note> {
  constructor(database: PostgresDatabase) {
    super(database, noteRepository);
  }

  async insertFixtures(
    fixtures: readonly Note[],
    context: TransactionContext,
  ): Promise<void> {
    await this.createMany(fixtures, { context });
  }
}

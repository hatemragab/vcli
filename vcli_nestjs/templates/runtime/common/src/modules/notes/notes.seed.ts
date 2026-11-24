import { z } from 'zod';
import type { ModuleSeeder } from '../../core/database/module-seeder.js';
import { SeedError } from '../../core/database/seed-error.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { AccountService } from '../accounts/account.service.js';
import { assertNotesInitialized } from './initialize-notes.js';
import { NotesSeedStore } from './notes-seed-store.js';
import { validateNote, type Note, type NoteDraft } from './notes-input.js';

const drafts = [
  {
    id: '389e8c8f-4963-4cd5-b3d7-2b7292f9a835',
    title: 'First-week checklist',
    body: 'Read the project README, run the local checks, and write down the next action.',
    createdAt: Date.UTC(2025, 0, 15, 9),
  },
  {
    id: '5934e498-6f47-46c7-b4e0-a44df29112bc',
    title: 'Ideas for the team demo',
    body: 'Show how a note captures a decision, then share a short list of next steps.',
    createdAt: Date.UTC(2025, 0, 15, 10),
  },
] satisfies readonly NoteDraft[];

export const seedNotes: ModuleSeeder = async (database) => {
  const suppliedOwner = process.env.VCLI_SEED_ACCOUNT_ID?.trim();
  if (!suppliedOwner)
    throw new SeedError(
      'SEED_ACCOUNT_REQUIRED',
      'Set VCLI_SEED_ACCOUNT_ID to the UUID of an existing enabled demo account in this database.',
    );
  const parsedOwner = z.uuid().safeParse(suppliedOwner);
  if (!parsedOwner.success)
    throw new SeedError(
      'SEED_ACCOUNT_INVALID',
      'Set VCLI_SEED_ACCOUNT_ID to a valid account UUID.',
    );

  const ownerId = parsedOwner.data.toLowerCase();
  const fixtures = drafts.map((draft) => validateNote({ ...draft, ownerId }));
  await assertNotesInitialized(database).catch((error: unknown) => {
    if (
      error instanceof ApplicationError &&
      error.code === 'NOTES_SCHEMA_NOT_INITIALIZED'
    )
      throw new SeedError(
        'SEED_SCHEMA_NOT_READY',
        'Check DATABASE_URL. If the release is recorded but Notes storage is missing, use a freshly initialized local database or repair its schema through a reviewed migration.',
      );
    throw error;
  });
  const accounts = new AccountService(database);
  const notes = new NotesSeedStore(database);

  return database.run(async (context) => {
    const account = await accounts.findById(ownerId, { context });
    if (!account)
      throw new SeedError(
        'SEED_ACCOUNT_NOT_FOUND',
        'Create or enroll a demo account through the configured sign-in flow, then set VCLI_SEED_ACCOUNT_ID to its UUID in this database.',
      );
    if (account.enabled !== true)
      throw new SeedError(
        'SEED_ACCOUNT_NOT_ACTIVE',
        'Select an existing enabled demo account in this database.',
      );

    const missing: Note[] = [];
    for (const fixture of fixtures) {
      const existing = await notes.findById(fixture.id, { context });
      if (!existing) missing.push(fixture);
      else if (existing.ownerId !== ownerId)
        throw new SeedError(
          'SEED_FIXTURE_OWNER_COLLISION',
          'A sample Note ID is already held by a different account. Select the original owner or use a separate demo database.',
        );
    }
    if (missing.length) await notes.insertFixtures(missing, context);
    return {
      created: missing.length,
      alreadyPresent: fixtures.length - missing.length,
    };
  });
};

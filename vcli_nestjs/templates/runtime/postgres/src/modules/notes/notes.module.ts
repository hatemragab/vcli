import { Module } from '@nestjs/common';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { bootstrapBinding } from '../../core/bootstrap/bootstrap-bindings.js';
import type { AppConfig } from '../../core/config/app-config.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import type { EventPublisher } from '../../core/realtime/event-publisher.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';
import { assertNotesInitialized } from './initialize-notes.js';

const notesServiceBinding = bootstrapBinding(NotesService);
export const bindNotesService = notesServiceBinding.bind;

@Module({
  imports: [HttpSecurityModule],
  controllers: [NotesController],
  providers: [notesServiceBinding.provider],
  exports: [NotesService],
})
export class NotesModule {}

/** Uses the caller-owned selected database; never opens/closes a connection or applies schema. */
export async function createNotesRuntime(
  _config: AppConfig,
  database: PostgresDatabase,
  authority: PrincipalAuthority,
  publisher?: EventPublisher,
) {
  await assertNotesInitialized(database);
  return {
    bindings: [
      bindNotesService(new NotesService(database, authority, publisher)),
    ],
  };
}

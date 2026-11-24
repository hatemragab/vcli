import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { EventPublisher } from '../../core/realtime/event-publisher.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';
import { assertNotesInitialized } from './initialize-notes.js';

@Module({})
export class NotesModule {
  static register(
    authority: PrincipalAuthority,
    service: NotesService,
  ): DynamicModule {
    return {
      module: NotesModule,
      imports: [HttpSecurityModule.register(authority)],
      controllers: [NotesController],
      providers: [{ provide: NotesService, useValue: service }],
      exports: [NotesService],
    };
  }
}
/** Uses the caller-owned selected database; never opens/closes a connection or applies schema. */
export async function createNotesRuntime(
  _config: AppConfig,
  database: MongoDatabase,
  authority: PrincipalAuthority,
  publisher?: EventPublisher,
) {
  await assertNotesInitialized(database);
  return {
    module: NotesModule.register(
      authority,
      new NotesService(database, authority, publisher),
    ),
  };
}

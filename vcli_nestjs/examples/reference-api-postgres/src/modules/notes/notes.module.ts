import { Module, type DynamicModule } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AppConfig } from '../../core/config/app-config.js';
import { openDatabase } from '../../core/database/database.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';

import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { EventPublisher } from '../../core/realtime/event-publisher.js';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';
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
export async function createNotesRuntime(
  config: AppConfig,
  authority: PrincipalAuthority,
  publisher: EventPublisher,
  options: Readonly<{
    schemaSetup?: boolean;
  }> = {},
) {
  const database = await openDatabase(config, !options.schemaSetup);
  try {
    if (!options.schemaSetup) {
      await database.run(async (context) => {
        await database
          .context(context)
          .execute(sql`SELECT id FROM reference_notes LIMIT 0`);
      });
    }
    const service = new NotesService(database, publisher);
    return {
      module: NotesModule.register(authority, service),
      migrate: () => service.initializeSchema(),
      close: () => database.close(),
    };
  } catch (error: unknown) {
    await database.close();
    throw error;
  }
}

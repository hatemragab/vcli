import { getTableColumns } from 'drizzle-orm';
import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { PostgresDatabase } from '../../core/database/postgres-database.js';
import { installationTable, type Installation } from './installation.entity.js';

@Injectable()
export class InstallationService extends BaseRepository<Installation> {
  constructor(database: PostgresDatabase) {
    super(database, {
      table: installationTable,
      columns: { ...getTableColumns(installationTable) },
      conflictTargets: [['id']],
    });
  }
}

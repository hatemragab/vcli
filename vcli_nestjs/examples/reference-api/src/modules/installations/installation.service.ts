import { Injectable } from '@nestjs/common';
import { BaseRepository } from '../../core/database/base-repository.js';
import type { MongoDatabase } from '../../core/database/mongo-database.js';
import {
  installationSchema,
  type Installation,
} from './installation.entity.js';
@Injectable()
export class InstallationService extends BaseRepository<Installation> {
  constructor(database: MongoDatabase) {
    super(
      database,
      'ReferenceInstallation',
      installationSchema,
      'INSTALLATION_EXISTS',
    );
  }
}

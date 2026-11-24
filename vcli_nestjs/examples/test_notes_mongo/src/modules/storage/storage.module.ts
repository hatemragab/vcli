import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import type { StorageProfile } from './storage.entity.js';
import { LocalStorageService } from './local-storage.service.js';
import { StorageService } from './storage.service.js';

export function selectedStorageProfile(
  _config: AppConfig,
  root: string,
): StorageProfile {
  return { version: 1, driver: 'local', root };
}
@Module({})
export class StorageModule {
  static register(
    service: StorageService = new StorageService(new LocalStorageService()),
  ): DynamicModule {
    return {
      module: StorageModule,
      providers: [{ provide: StorageService, useValue: service }],
      exports: [StorageService],
    };
  }
}

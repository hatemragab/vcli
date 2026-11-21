import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { StorageProfile } from './storage.entity.js';
import { LocalStorageService } from './local-storage.service.js';
import { StorageService } from './storage.service.js';

export function selectedStorageProfile(
  config: AppConfig,
  root: string,
): StorageProfile {
  if (config.storage.driver === 'local')
    return { version: 1, driver: 'local', root };
  const storage = config.storage;
  if (!storage.bucket || storage.s3Profile === 'custom')
    throw new ApplicationError('UNSUPPORTED_STORAGE_PROFILE', 500);
  if (
    storage.s3Profile === 'r2' &&
    (!storage.endpoint ||
      storage.region !== 'auto' ||
      !/^https:\/\/[a-zA-Z0-9.-]+\.r2\.cloudflarestorage\.com\/?$/.test(
        storage.endpoint,
      ))
  )
    throw new ApplicationError('INVALID_R2_PROFILE', 500);
  if (storage.s3Profile === 'aws' && storage.endpoint)
    throw new ApplicationError('AWS_ENDPOINT_OVERRIDE_UNSUPPORTED', 500);
  return {
    version: 1,
    driver: 's3',
    profile: storage.s3Profile,
    bucket: storage.bucket,
    region: storage.region,
    endpoint: storage.endpoint,
    forcePathStyle: storage.forcePathStyle,
  };
}

@Module({})
export class StorageModule {
  static register(
    service = new StorageService(new LocalStorageService()),
  ): DynamicModule {
    return {
      module: StorageModule,
      providers: [{ provide: StorageService, useValue: service }],
      exports: [StorageService],
    };
  }
}

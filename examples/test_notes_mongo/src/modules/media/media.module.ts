import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { StorageService } from '../storage/storage.service.js';
import { MediaService } from './media.service.js';
import {
  MediaController,
  MEDIA_HTTP_OPTIONS,
  type MediaHttpOptions,
} from './media.controller.js';
import { MediaRepository } from './media.repository.js';
import { MongoMediaStateStore } from './mongo-media-state-store.js';
import type { MediaStateStore } from './media-state-store.js';
export async function initializeMediaSchema(config: AppConfig): Promise<void> {
  const store = await MongoMediaStateStore.connect(config.database.url, true);
  await store.close();
}
@Module({})
export class MediaModule {
  static register(
    store: MediaStateStore,
    authority: PrincipalAuthority,
    options: MediaHttpOptions,
    storage: StorageService,
  ): DynamicModule {
    return {
      module: MediaModule,
      imports: [
        HttpSecurityModule.register(authority),
        StorageModule.register(storage),
      ],
      controllers: [MediaController],
      providers: [
        {
          provide: MediaRepository,
          useFactory: () => new MediaRepository(store),
        },
        {
          provide: MediaService,
          inject: [MediaRepository, StorageService],
          useFactory: (repository: MediaRepository, storage: StorageService) =>
            new MediaService(repository, storage, authority),
        },
        { provide: MEDIA_HTTP_OPTIONS, useValue: options },
      ],
      exports: [MediaService],
    };
  }
}
export async function createMediaRuntime(
  config: AppConfig,
  authority: PrincipalAuthority,
  options: MediaHttpOptions,
  storage: StorageService,
) {
  const store = await MongoMediaStateStore.connect(config.database.url, false);
  try {
    return {
      module: MediaModule.register(
        store,
        authority,
        { ...options, modes: config.storage.modes },
        storage,
      ),
      close: () => store.close(),
    };
  } catch (error) {
    await store.close();
    throw error;
  }
}

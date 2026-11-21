import { Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { MailSubmitter } from '../../core/mail/mail-submitter.js';
import { MailModule } from '../mail/mail.module.js';
import {
  createPushRuntime,
  initializePushSchema,
  PushModule,
} from '../push/push.module.js';
import { PrivateFilesystem } from '../storage/private-filesystem.js';
import { LocalStorageService } from '../storage/local-storage.service.js';
import {
  selectedStorageProfile,
  StorageModule,
} from '../storage/storage.module.js';
import { StorageService } from '../storage/storage.service.js';
import { CapabilitiesModule } from './capabilities.module.js';
import { MediaService } from './media.service.js';
import {
  MediaController,
  MEDIA_HTTP_OPTIONS,
  type MediaHttpOptions,
} from './media.controller.js';
import { MediaRepository } from './media.repository.js';
import { PostgresMediaStateStore } from './postgres-media-state-store.js';
import type { MediaStateStore } from './media-state-store.js';

async function mediaStore(
  config: AppConfig,
  initialize: boolean,
): Promise<MediaStateStore> {
  return PostgresMediaStateStore.connect(config.database.url, initialize);
}

/** Media only consumes storage and shared security; push is composed as a sibling below. */
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
            new MediaService(repository, storage),
        },
        { provide: MEDIA_HTTP_OPTIONS, useValue: options },
      ],
      exports: [MediaService, StorageModule],
    };
  }
}

/** Explicit owner-schema setup; no feature is imported from core/database. */
export async function initializeCapabilitySchemas(
  config: AppConfig,
): Promise<void> {
  const media = await mediaStore(config, true);
  try {
    await initializePushSchema(config);
  } finally {
    await media.close();
  }
}

/** Above the participants: root retains its { module, close } integration contract. */
export async function createCapabilitiesRuntime(
  config: AppConfig,
  authority: PrincipalAuthority,
  mail: MailSubmitter,
): Promise<{ module: DynamicModule; close(): Promise<void> }> {
  if (config.environment === 'production' && config.mail.driver === 'capture')
    throw new ApplicationError('UNSAFE_PRODUCTION_PROFILE', 500);
  if (config.push.fcmEnabled && !config.auth.firebaseProjectId)
    throw new ApplicationError('FCM_PROJECT_ID_REQUIRED', 500);
  const filesystem = new PrivateFilesystem(config.storage.localRoot);
  const profile = selectedStorageProfile(config, filesystem.root);
  await filesystem.initialize();
  const storage = new StorageService(new LocalStorageService());
  const media = await mediaStore(config, false);
  let push: Awaited<ReturnType<typeof createPushRuntime>> | undefined;
  try {
    push = await createPushRuntime(config, authority);
    let closed = false;
    return {
      module: {
        module: CapabilitiesModule,
        imports: [
          MediaModule.register(
            media,
            authority,
            {
              maximum: config.storage.maxBytes,
              ttlSeconds: config.storage.uploadTtlSeconds,
              profile,
              stagingRoot: filesystem.root,
            },
            storage,
          ),
          push.module,
          MailModule.register(mail),
        ],
        exports: [MediaModule, PushModule, MailModule],
      },
      close: async () => {
        if (closed) return;
        closed = true;
        storage.close();
        await Promise.allSettled([media.close(), push?.close()]);
      },
    };
  } catch (error: unknown) {
    storage.close();
    await Promise.allSettled([media.close(), push?.close()]);
    throw error;
  }
}

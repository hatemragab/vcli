import { Module, type DynamicModule } from '@nestjs/common';
import {
  applicationDefault,
  deleteApp,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { AppConfig } from '../../core/config/app-config.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { PurposeRoutes } from './push.entity.js';
import type { PushSender } from './push.entity.js';
import { PushService } from './push.service.js';
import { PushController, PUSH_SCOPE } from './push.controller.js';
import { PushRepository } from './push.repository.js';
import { PostgresPushStateStore } from './postgres-push-state-store.js';
import type { PushStateStore } from './push-state-store.js';
import { ApnsPushService } from './apns-push.service.js';
import { FcmPushService } from './fcm-push.service.js';

async function pushStore(
  config: AppConfig,
  initialize: boolean,
): Promise<PushStateStore> {
  return PostgresPushStateStore.connect(config.database.url, initialize);
}

export async function initializePushSchema(config: AppConfig): Promise<void> {
  const store = await pushStore(config, true);
  await store.close();
}

export async function createPushRuntime(
  config: AppConfig,
  authority: PrincipalAuthority,
): Promise<{ module: DynamicModule; close(): Promise<void> }> {
  if (config.push.fcmEnabled && !config.auth.firebaseProjectId)
    throw new ApplicationError('FCM_PROJECT_ID_REQUIRED', 500);
  const store = await pushStore(config, false);
  let firebase: App | undefined;
  try {
    const senders: Partial<Record<'fcm' | 'apns', PushSender>> = {};
    if (config.push.fcmEnabled) {
      firebase = initializeApp(
        {
          projectId: config.auth.firebaseProjectId,
          credential: applicationDefault(),
        },
        `reference-push-${randomUUID()}`,
      );
      senders.fcm = new FcmPushService(firebase);
    }
    if (config.push.apnsEnabled)
      senders.apns = await ApnsPushService.create(config.push);
    const routes: PurposeRoutes = {
      ordinary: config.push.fcmEnabled
        ? 'fcm'
        : config.push.apnsEnabled
          ? 'apns'
          : undefined,
      background: config.push.apnsEnabled ? 'apns' : undefined,
      voip: config.push.apnsEnabled ? 'apns' : undefined,
    };
    const scope = `${config.environment}:${config.publicOrigin}:${config.auth.firebaseProjectId ?? ''}:${config.push.apnsTopic ?? ''}:${config.push.apnsProduction ? 'production' : 'sandbox'}`;
    let closed = false;
    return {
      module: {
        module: PushModule,
        imports: [HttpSecurityModule.register(authority)],
        controllers: [PushController],
        providers: [
          {
            provide: PushRepository,
            useFactory: () => new PushRepository(store),
          },
          {
            provide: PushService,
            inject: [PushRepository],
            useFactory: (destinations: PushRepository) =>
              new PushService(
                destinations,
                senders,
                authority,
                async (milliseconds) => {
                  if (milliseconds > 0) await delay(milliseconds);
                  return Date.now();
                },
                routes,
                scope,
              ),
          },
          { provide: PUSH_SCOPE, useValue: scope },
        ],
        exports: [PushService],
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await Promise.allSettled([
          store.close(),
          firebase ? deleteApp(firebase) : Promise.resolve(),
        ]);
      },
    };
  } catch (error: unknown) {
    await Promise.allSettled([
      store.close(),
      firebase ? deleteApp(firebase) : Promise.resolve(),
    ]);
    throw error;
  }
}

@Module({})
export class PushModule {}

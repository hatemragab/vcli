import 'reflect-metadata';
import {
  databaseTest as test,
  postgresFixture,
} from './helpers/postgres-fixture.ts';
import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../dist/core/config/load-config.js';
import type { Principal } from '../dist/core/auth/principal.js';
import { createTestMailCapture } from '../dist/modules/mail/mail.module.js';
import { MailService } from '../dist/modules/mail/mail.service.js';
import { createCapabilitiesRuntime } from '../dist/modules/media/media.module.js';
import { MediaService } from '../dist/modules/media/media.service.js';
import { PushService } from '../dist/modules/push/push.service.js';
import { StorageService } from '../dist/modules/storage/storage.service.js';

class CapabilityConsumerModule {}
Module({})(CapabilityConsumerModule);

test('capability composition exports directly injectable services and keeps capture private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reference-capabilities-'));
  await chmod(root, 0o700);
  const testDatabase = await postgresFixture();
  const config = loadConfig({
    DATABASE_URL: testDatabase.url,
    LOCAL_STORAGE_ROOT: root,
  });
  const principal: Principal = {
    accountId: 'owner',
    sessionId: 'session',
    installationId: 'installation',
    expiresAt: 100000,
  };
  const capture = createTestMailCapture();
  const runtime = await createCapabilitiesRuntime(
    config,
    {
      verify: async () => principal,
      current: async () => principal,
    },
    capture.sender,
  );
  let app:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;
  try {
    const consumer = Symbol('CapabilityConsumer');
    app = await NestFactory.createApplicationContext(
      {
        module: CapabilityConsumerModule,
        imports: [runtime.module],
        providers: [
          {
            provide: consumer,
            inject: [MailService, StorageService, MediaService, PushService],
            useFactory: (
              mail: MailService,
              storage: StorageService,
              media: MediaService,
              push: PushService,
            ) => ({ mail, storage, media, push }),
          },
        ],
      },
      { logger: false, abortOnError: false },
    );
    assert.ok(app.get(consumer));
    assert.ok(app.get(MediaService) instanceof MediaService);
    assert.ok(app.get(StorageService) instanceof StorageService);
    assert.ok(app.get(PushService) instanceof PushService);
    const mail = app.get(MailService);
    assert.equal(mail, capture.sender);
    assert.equal('inspect' in mail, false);
    assert.equal('clear' in mail, false);
    await mail.submit({
      operationId: 'private-action',
      to: 'person@example.test',
      subject: 'Action',
      text: 'private-proof',
      purpose: 'verification',
    });
    assert.equal(capture.inspect().length, 1);
  } finally {
    await app?.close();
    await runtime.close();
    await testDatabase.close();
    capture.clear();
    await rm(root, { recursive: true, force: true });
  }
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../dist/core/config/load-config.js';
import { DIAGNOSTIC_EVENTS } from '../dist/core/diagnostics/diagnostic-events.js';
import type { PrincipalAuthority } from '../dist/core/auth/principal-authority.js';
import { AppLoggerService } from '../dist/core/logging/app-logger.service.js';
import { LoggingModule } from '../dist/core/logging/logging.module.js';
import { DiagnosticsService } from '../dist/modules/diagnostics/diagnostics.service.js';
import { createOperationsRuntime } from '../dist/modules/realtime/realtime.module.js';
import { RealtimeService } from '../dist/modules/realtime/realtime.service.js';
import { RealtimeTicketService } from '../dist/modules/realtime/realtime-ticket.service.js';
const authority: PrincipalAuthority = {
  async verify() {
    throw new Error('CREDENTIAL_REQUIRED');
  },
  async current() {
    throw new Error('SESSION_REQUIRED');
  },
};
test('each protocol shares application logging without owning retained evidence lifetime', async () => {
  for (const driver of ['socketio', 'ws', 'centrifugo'] as const) {
    const directory = await mkdtemp(
      join(tmpdir(), 'reference-realtime-module-'),
    );
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused.invalid/config',
    });
    const writer = await DiagnosticsService.open(
      { ...config.diagnostics, directory },
      'test',
    );
    const logger = new AppLoggerService('test', writer, { write() {} });
    const runtime = await createOperationsRuntime(
      {
        ...config,
        diagnostics: { ...config.diagnostics, directory },
        realtime: {
          ...config.realtime,
          driver,
          centrifugoApiUrl: 'http://private.invalid/api',
          centrifugoApiKey: 'fixture-api-key',
          centrifugoProxySecret:
            'fixture-separate-proxy-secret-at-least-32-characters',
        },
      },
      authority,
      logger,
    );
    let context: INestApplicationContext | undefined;
    try {
      context = await NestFactory.createApplicationContext(
        {
          ...runtime.module,
          imports: [
            ...(runtime.module.imports ?? []),
            LoggingModule.register(logger),
          ],
        },
        {
          logger: false,
          abortOnError: false,
        },
      );
      assert.equal(context.get(RealtimeService), runtime.publisher);
      assert.equal(context.get(AppLoggerService), logger);
      assert.equal(context.get(DIAGNOSTIC_EVENTS), logger);
      assert.ok(
        context.get(RealtimeTicketService) instanceof RealtimeTicketService,
      );
      assert.equal(writer.status().available, true);
      const firstClose = runtime.close();
      assert.equal(runtime.close(), firstClose);
      await firstClose;
      assert.equal(writer.status().available, true);
      logger.record({ event: 'application.stopping', severity: 'info' });
      assert.equal(await writer.flush(), true);
    } finally {
      await runtime.close();
      await context?.close();
      await writer.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
});

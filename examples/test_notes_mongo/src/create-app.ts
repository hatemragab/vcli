import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  RequestMethod,
  type INestApplication,
  type DynamicModule,
} from '@nestjs/common';
import { json } from 'express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './core/config/app-config.js';
import { AppLoggerService } from './core/logging/app-logger.service.js';
import { ApplicationError } from './core/errors/application-error.js';
import { LoggingModule } from './core/logging/logging.module.js';
import { HttpErrorFilter } from './core/http/http-error.filter.js';
import { recordRequest } from './core/http/record-request.js';
import { HealthModule } from './modules/health/health.module.js';
import { HealthStateService } from './modules/health/health-state.service.js';
import { openDatabase } from './core/database/database.js';
import { DatabaseModule } from './core/database/database.module.js';
import {
  assertSelectedReleaseReady,
  selectedReleaseManifest,
} from './generated/selected-release.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { applyOpenApiSecurity } from './core/http/openapi-security.js';
import { createIdentityRuntime } from './modules/identity/identity.module.js';
import { PrivateFilesystem } from './modules/storage/private-filesystem.js';
import { LocalStorageService } from './modules/storage/local-storage.service.js';
import { StorageService } from './modules/storage/storage.service.js';
import {
  StorageModule,
  selectedStorageProfile,
} from './modules/storage/storage.module.js';
import { createMediaRuntime } from './modules/media/media.module.js';
import { createNotesRuntime } from './modules/notes/notes.module.js';
import { SourceEvidenceService } from './modules/diagnostics/source-evidence.service.js';
import { DiagnosticReaderService } from './modules/diagnostics/diagnostic-reader.service.js';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module.js';
import { DatabaseDiagnosticsService } from './core/diagnostics/database-diagnostics.service.js';
import { InfrastructureDiagnosticsService } from './core/diagnostics/infrastructure-diagnostics.service.js';
export type ApplicationRuntime = Readonly<{
  app: INestApplication;
  config: AppConfig;
  logger: AppLoggerService;
  close(): Promise<void>;
}>;

export async function createApp(
  config: AppConfig,
): Promise<ApplicationRuntime> {
  const diagnostics = await SourceEvidenceService.open(
    config.diagnostics,
    config.environment,
    config.diagnostics.sources,
  );
  const logger = new AppLoggerService(config.environment, diagnostics);

  const databaseDiagnostics = new DatabaseDiagnosticsService(logger, 'mongodb');
  logger.record({ event: 'application.starting', severity: 'info' });
  const cleanup: Array<() => Promise<void>> = [];
  let app: INestApplication | undefined, closing: Promise<void> | undefined;

  let startupStage: 'database' | 'schema' | 'modules' = 'modules';
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      if (app) {
        try {
          app.get(HealthStateService).markStopping();
        } catch {
          /* Startup may have failed before provider creation. */
        }
      }
      logger.record({ event: 'application.stopping', severity: 'info' });
      let failed = false;
      for (const step of [
        ...(app ? [() => app!.close()] : []),
        ...cleanup.slice().reverse(),
      ]) {
        try {
          await step();
        } catch {
          failed = true;
        }
      }
      logger.record({
        event: failed ? 'application.shutdown-failed' : 'application.stopped',
        severity: failed ? 'error' : 'info',
      });
      try {
        await diagnostics.close();
      } catch {
        failed = true;
      }
      await logger.flush();
      if (failed) throw new Error('SHUTDOWN_FAILED');
    })());
  try {
    const infrastructure = new InfrastructureDiagnosticsService(logger);
    infrastructure.start();
    cleanup.push(async () => {
      infrastructure.stop();
    });
    startupStage = 'database';
    const db = await openDatabase(config, true, databaseDiagnostics);
    cleanup.push(() => db.close());
    startupStage = 'schema';
    await assertSelectedReleaseReady(db);
    startupStage = 'modules';

    const identity = await createIdentityRuntime(config, db);
    cleanup.push(() => identity.close());
    const filesystem = new PrivateFilesystem(config.storage.localRoot);
    await filesystem.initialize();
    const storage = new StorageService(new LocalStorageService());
    cleanup.push(async () => {
      storage.close();
    });
    const media = await createMediaRuntime(
      config,
      identity.authority,
      {
        maximum: config.storage.maxBytes,
        ttlSeconds: config.storage.uploadTtlSeconds,
        profile: selectedStorageProfile(config, filesystem.root),
        stagingRoot: filesystem.root,
        modes: config.storage.modes,
      },
      storage,
    );
    cleanup.push(() => media.close());

    const notes = await createNotesRuntime(config, db, identity.authority);
    const capabilities: Record<string, DynamicModule> = {
      database: DatabaseModule.register(db),
      auth: identity.module,
      storage: StorageModule.register(storage),
      media: media.module,
      notes: notes.module,
      diagnostics: DiagnosticsModule.register(
        diagnostics,
        new DiagnosticReaderService(config.diagnostics, config.environment, {
          sources: config.diagnostics.sources,
        }),
        databaseDiagnostics,
        infrastructure,
      ),
    };
    app = await NestFactory.create(
      AppModule.register(
        [
          LoggingModule.register(logger),
          { module: HealthModule },
          ...Object.values(capabilities),
        ],
        capabilities,
      ),
      { logger, abortOnError: false, bodyParser: false },
    );
    app.use(recordRequest(logger));
    app.use(json({ limit: '64kb' }));
    app.useGlobalFilters(new HttpErrorFilter(logger));
    app.enableCors({
      origin: [...config.allowedOrigins],
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'X-Session-Token',
        'X-Request-Id',
      ],
      exposedHeaders: ['X-Request-Id', 'X-Operation-Id'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
    app.setGlobalPrefix('api', {
      exclude: ['health/live', 'health/ready'].map((path) => ({
        path,
        method: RequestMethod.GET,
      })),
    });
    const documentBuilder = new DocumentBuilder()
      .setTitle('test_notes_mongo API')
      .setVersion('1')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer');
    const document = SwaggerModule.createDocument(app, documentBuilder.build());
    applyOpenApiSecurity(document);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: false },
    });
    await app.init();
    app.get(HealthStateService).markReady(selectedReleaseManifest.id);
    return { app, config, logger, close };
  } catch (error) {
    const thrown = error instanceof ApplicationError ? error.code : '';
    const releaseMissing = thrown === 'DATABASE_INITIALIZATION_REQUIRED';
    const code = releaseMissing
      ? 'SCHEMA_RELEASE_REQUIRED'
      : thrown ||
        (startupStage === 'database'
          ? 'DATABASE_UNAVAILABLE'
          : startupStage === 'schema'
            ? 'SCHEMA_RELEASE_REQUIRED'
            : 'STARTUP_FAILED');
    const safe = [
      'DATABASE_UNAVAILABLE',
      'DATABASE_URL_REQUIRED',
      'SCHEMA_RELEASE_REQUIRED',
      'INVALID_CONFIG',
      'STARTUP_FAILED',
    ].includes(code)
      ? code
      : startupStage === 'schema'
        ? 'SCHEMA_RELEASE_REQUIRED'
        : startupStage === 'database'
          ? 'DATABASE_UNAVAILABLE'
          : 'STARTUP_FAILED';
    const reported = releaseMissing ? 'schema' : startupStage;
    logger.record({
      event: 'application.start-failed',
      severity: 'error',
      errorCode: safe as
        | 'DATABASE_UNAVAILABLE'
        | 'DATABASE_URL_REQUIRED'
        | 'SCHEMA_RELEASE_REQUIRED'
        | 'INVALID_CONFIG'
        | 'STARTUP_FAILED',
      stage: reported,
    });
    await close().catch(() => undefined);
    throw new ApplicationError(safe, 500);
  }
}

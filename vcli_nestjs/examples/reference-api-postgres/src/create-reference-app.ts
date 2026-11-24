import 'reflect-metadata';
import { type INestApplication, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { createIdentityRuntime } from './modules/identity/identity.module.js';
import { createMailSender } from './modules/mail/mail.module.js';
import { createCapabilitiesRuntime } from './modules/media/media.module.js';
import { createNotesRuntime } from './modules/notes/notes.module.js';
import { createOperationsRuntime } from './modules/realtime/realtime.module.js';
import type { AppConfig } from './core/config/app-config.js';
import { loadConfig } from './core/config/load-config.js';
import { HttpErrorFilter } from './core/http/http-error.filter.js';
import { recordRequest } from './core/http/record-request.js';
import { applyOpenApiSecurity } from './core/http/openapi-security.js';
import { ApplicationError } from './core/errors/application-error.js';
import type { MailSubmitter } from './core/mail/mail-submitter.js';
import { diagnosticErrorCode } from './core/errors/diagnostic-error-code.js';
import { AppLoggerService } from './core/logging/app-logger.service.js';
import { LoggingModule } from './core/logging/logging.module.js';
import { DiagnosticsService } from './modules/diagnostics/diagnostics.service.js';
import { DiagnosticReaderService } from './modules/diagnostics/diagnostic-reader.service.js';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module.js';

export type ReferenceApplication = Readonly<{
  app: INestApplication;
  config: AppConfig;
  logger: AppLoggerService;
  close(): Promise<void>;
}>;

export async function createReferenceApp(
  config: AppConfig = loadConfig(),
  options: Readonly<{ mail?: MailSubmitter }> = {},
): Promise<ReferenceApplication> {
  if (options.mail && config.environment === 'production')
    throw new ApplicationError('TEST_MAIL_OVERRIDE_PROHIBITED', 500);
  const diagnostics = await DiagnosticsService.open(
    config.diagnostics,
    config.environment,
  );
  const logger = new AppLoggerService(config.environment, diagnostics);
  const reader = new DiagnosticReaderService(
    config.diagnostics,
    config.environment,
  );
  logger.record({ event: 'application.starting', severity: 'info' });
  const cleanup: Array<() => Promise<void>> = [];
  let app: INestApplication | undefined;
  let stopRealtime: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      logger.record({ event: 'application.stopping', severity: 'info' });
      let failed = false;
      const steps = [
        ...(stopRealtime ? [stopRealtime] : []),
        ...(app ? [() => app!.close()] : []),
        ...cleanup.slice().reverse(),
      ];
      for (const operation of steps) {
        try {
          await operation();
        } catch {
          failed = true;
        }
      }
      logger.record({
        event: failed ? 'application.shutdown-failed' : 'application.stopped',
        severity: failed ? 'error' : 'info',
        ...(failed ? { errorCode: 'SHUTDOWN_FAILED' as const } : {}),
      });
      await diagnostics.close();
      await logger.flush();
      if (failed) throw new Error('REFERENCE_CLEANUP_INCOMPLETE');
    })());
  try {
    const mail = options.mail ?? createMailSender(config);
    const identity = await createIdentityRuntime(config, mail);
    cleanup.push(() => identity.close());
    const capabilities = await createCapabilitiesRuntime(
      config,
      identity.authority,
      mail,
    );
    cleanup.push(() => capabilities.close());
    const operations = await createOperationsRuntime(
      config,
      identity.authority,
      logger,
    );
    stopRealtime = () => operations.close();
    const notes = await createNotesRuntime(
      config,
      identity.authority,
      operations.publisher,
    );
    cleanup.push(() => notes.close());
    app = await NestFactory.create(
      AppModule.register(config, [
        LoggingModule.register(logger),
        DiagnosticsModule.register(diagnostics, reader),
        identity.module,
        capabilities.module,
        operations.module,
        notes.module,
      ]),
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
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    });
    app.setGlobalPrefix('api', {
      exclude: [
        '',
        'health/live',
        'health/ready',
        'reference',
        'reference/config',
      ].map((path) => ({ path, method: RequestMethod.GET })),
    });
    if (config.environment !== 'production') {
      const builder = new DocumentBuilder()
        .setTitle('VCLI reference API')
        .setDescription(
          'Hand-built expected-output prototype. External provider/device/deployment acceptance is recorded separately.',
        )
        .setVersion('0.0.0')
        .addBearerAuth();
      if (config.auth.driver === 'firebase')
        builder.addSecurity('appSession', {
          type: 'apiKey',
          in: 'header',
          name: 'X-Session-Token',
        });
      if (config.realtime.driver === 'centrifugo')
        builder.addSecurity('centrifugoProxy', {
          type: 'apiKey',
          in: 'header',
          name: 'X-Centrifugo-Proxy-Secret',
        });
      const document = SwaggerModule.createDocument(app, builder.build());
      applyOpenApiSecurity(document, config.auth.driver);
      SwaggerModule.setup('docs', app, document);
    }
    await app.init();
    await operations.attach(app.getHttpServer() as Server);
    return { app, config, logger, close };
  } catch (error: unknown) {
    logger.record({
      event: 'application.start-failed',
      severity: 'error',
      errorCode: diagnosticErrorCode(error, 'STARTUP_FAILED'),
    });
    await close().catch(() => undefined);
    throw error;
  }
}

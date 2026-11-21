import { createApp, type ApplicationRuntime } from './create-app.js';
import { loadConfig, loadSelectedEnvFile } from './core/config/load-config.js';
import { ApplicationError } from './core/errors/application-error.js';
import { AppLoggerService } from './core/logging/app-logger.service.js';
const configCodes = new Set([
  'INVALID_CONFIG',
  'INVALID_JWT_POLICY',
  'INVALID_SMTP_CONFIG',
  'UNSAFE_PRODUCTION_CAPTURE',
  'RUNTIME_PROVIDER_SELECTION_UNSUPPORTED',
  'UNSAFE_ENV_FILE',
  'ENV_FILE_UNAVAILABLE',
  'INVALID_FIREBASE_ACTION_POLICY',
  'INVALID_PUSH_ENVIRONMENT',
  'INVALID_MAIL_DELIVERY_KEYS',
  'INVALID_MAIL_DELIVERY_LEASE',
  'INVALID_CENTRIFUGO_CONFIG',
]);
function guidance(stage: string, code: string): string {
  if (stage === 'schema' || code === 'SCHEMA_RELEASE_REQUIRED')
    return 'vcli release apply';
  if (stage === 'config' || configCodes.has(code)) return 'vcli config check';
  if (stage === 'database') return 'vcli services status';
  return 'vcli dev';
}
let runtime: ApplicationRuntime | undefined;
let stage: 'config' | 'modules' | 'listen' = 'config';
try {
  loadSelectedEnvFile();
  const config = loadConfig();
  stage = 'modules';
  runtime = await createApp(config);
  stage = 'listen';
  await runtime.app.listen(runtime.config.port, runtime.config.host);
  runtime.logger.record({
    event: 'application.started',
    severity: 'info',
    stage: 'listen',
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void runtime!.close().catch(() => {
        process.exitCode = 1;
      });
    });
} catch (error) {
  process.exitCode = 1;
  const thrown = error instanceof ApplicationError ? error.code : '';
  const code =
    stage === 'listen'
      ? 'LISTEN_FAILED'
      : stage === 'config'
        ? configCodes.has(thrown)
          ? thrown
          : 'INVALID_CONFIG'
        : thrown || 'STARTUP_FAILED';
  const reported =
    stage === 'listen'
      ? 'listen'
      : stage === 'config'
        ? 'config'
        : code === 'SCHEMA_RELEASE_REQUIRED'
          ? 'schema'
          : code === 'DATABASE_UNAVAILABLE' || code === 'DATABASE_URL_REQUIRED'
            ? 'database'
            : 'modules';
  if (stage === 'config' || stage === 'listen') {
    const logger =
      runtime?.logger ??
      new AppLoggerService(
        process.env.NODE_ENV === 'production' ? 'production' : 'development',
      );
    logger.record({
      event: 'application.start-failed',
      severity: 'error',
      errorCode:
        stage === 'listen'
          ? 'LISTEN_FAILED'
          : thrown === 'ENV_FILE_UNAVAILABLE'
            ? 'ENV_FILE_UNAVAILABLE'
            : thrown === 'UNSAFE_ENV_FILE'
              ? 'UNSAFE_ENV_FILE'
              : thrown === 'RUNTIME_PROVIDER_SELECTION_UNSUPPORTED'
                ? 'RUNTIME_PROVIDER_SELECTION_UNSUPPORTED'
                : 'INVALID_CONFIG',
      stage: reported as 'config' | 'listen',
    });
    await logger.flush();
  }
  if (runtime) await runtime.close().catch(() => undefined);
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      status: 'failed',
      code,
      stage: reported,
      next: guidance(reported, code),
    }),
  );
}

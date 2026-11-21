import {
  createReferenceApp,
  type ReferenceApplication,
} from './create-reference-app.js';
import { loadConfig, loadSelectedEnvFile } from './core/config/load-config.js';
import { diagnosticErrorCode } from './core/errors/diagnostic-error-code.js';
import { AppLoggerService } from './core/logging/app-logger.service.js';

let runtime: ReferenceApplication | undefined;
let initializing = false;
try {
  loadSelectedEnvFile();
  const config = loadConfig();
  initializing = true;
  runtime = await createReferenceApp(config);
  await runtime.app.listen(config.port, config.host);
  runtime.logger.record({ event: 'application.started', severity: 'info' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void runtime!.close().then(
        () => {
          process.exitCode = 0;
        },
        () => {
          process.exitCode = 1;
        },
      );
    });
  }
} catch (error: unknown) {
  process.exitCode = 1;
  // Factory failures are retained before its cleanup. Configuration failures
  // occur before an evidence directory can be trusted, so use safe stdout only.
  if (runtime || !initializing) {
    const environment =
      process.env.NODE_ENV === 'production'
        ? 'production'
        : process.env.NODE_ENV === 'test'
          ? 'test'
          : 'development';
    const logger = runtime?.logger ?? new AppLoggerService(environment);
    logger.record({
      event: 'application.start-failed',
      severity: 'error',
      errorCode: diagnosticErrorCode(error, 'STARTUP_FAILED'),
    });
    if (runtime) await runtime.close().catch(() => undefined);
    else await logger.flush();
  }
}

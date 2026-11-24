import { loadConfig, loadSelectedEnvFile } from './core/config/load-config.js';
import { ApplicationError } from './core/errors/application-error.js';
import { initializeSelectedSchemas } from './generated/initialize-selected-schemas.js';
import { selectedReleaseManifest } from './generated/selected-release.js';
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
function report(
  code: string,
  next: string,
  extra: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      status: 'failed',
      code,
      next,
      ...extra,
    }),
  );
}
try {
  if (process.argv.length !== 2) {
    report('INVALID_ARGUMENTS', 'vcli release apply');
    process.exitCode = 1;
  } else {
    loadSelectedEnvFile();
    let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
    try {
      config = loadConfig();
    } catch (error) {
      const code =
        error instanceof ApplicationError && configCodes.has(error.code)
          ? error.code
          : 'INVALID_CONFIG';
      const prefix = 'Invalid configuration keys: ';
      const keys =
        error instanceof ApplicationError && error.message.startsWith(prefix)
          ? error.message
              .slice(prefix.length)
              .split(', ')
              .filter((key) => /^[A-Z][A-Z0-9_]{0,64}$/.test(key))
              .slice(0, 20)
          : [];
      report(code, 'vcli config check', keys.length ? { keys } : {});
      process.exitCode = 1;
      config = undefined;
    }
    if (config) {
      try {
        const owners = await initializeSelectedSchemas(config);
        console.log(
          JSON.stringify({
            schemaVersion: 1,
            status: 'completed',
            code: 'RELEASE_APPLIED',
            releaseId: selectedReleaseManifest.id,
            owners,
          }),
        );
      } catch {
        report('RELEASE_AMBIGUOUS', 'vcli release reconcile');
        process.exitCode = 1;
      }
    }
  }
} catch {
  report('RELEASE_FAILED', 'vcli release reconcile');
  process.exitCode = 1;
}

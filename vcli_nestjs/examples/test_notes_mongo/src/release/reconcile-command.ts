import { loadConfig, loadSelectedEnvFile } from '../core/config/load-config.js';
import { ApplicationError } from '../core/errors/application-error.js';
import { selectedReleaseManifest } from '../generated/selected-release.js';
import { ReleaseCoordinator } from './release-coordinator.js';
import { NativeReleaseStore } from './native-release-store.js';
import { readPrivateJson } from './private-files.js';
import { assertQuiescedDecision } from './release-validation.js';
import type { QuiescedReleaseDecision } from './release-types.js';
const configCodes = new Set([
  'INVALID_CONFIG',
  'ENV_FILE_UNAVAILABLE',
  'UNSAFE_ENV_FILE',
  'RUNTIME_PROVIDER_SELECTION_UNSUPPORTED',
]);
function report(code: string, next: string) {
  console.log(
    JSON.stringify({ schemaVersion: 1, status: 'failed', code, next }),
  );
}
let store: NativeReleaseStore | undefined;
try {
  if (process.argv.length !== 2 || !process.env.VCLI_RELEASE_DECISION) {
    report('INVALID_ARGUMENTS', 'vcli release reconcile');
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
      report(code, 'vcli config check');
      process.exitCode = 1;
    }
    if (config) {
      let started = false;
      try {
        const decision = (await readPrivateJson(
          process.env.VCLI_RELEASE_DECISION,
        )) as QuiescedReleaseDecision;
        assertQuiescedDecision(decision);
        store = await NativeReleaseStore.connect(config.database.url);
        started = true;
        await new ReleaseCoordinator(store).reconcile(
          selectedReleaseManifest,
          decision,
        );
        console.log(
          JSON.stringify({
            schemaVersion: 1,
            status: 'completed',
            code: 'RELEASE_RECONCILED',
            releaseId: selectedReleaseManifest.id,
          }),
        );
      } catch {
        report(
          started ? 'RELEASE_AMBIGUOUS' : 'RELEASE_FAILED',
          'vcli release reconcile',
        );
        process.exitCode = 1;
      }
    }
  }
} finally {
  if (store) await store.close();
}

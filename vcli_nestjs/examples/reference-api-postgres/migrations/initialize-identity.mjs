import {
  loadConfig,
  loadSelectedEnvFile,
} from '../dist/core/config/load-config.js';
import { initializeIdentityDatabase } from '../dist/initialize-identity-database.js';
loadSelectedEnvFile();
try {
  await initializeIdentityDatabase(loadConfig());
  console.info('Identity schema initialization completed');
} catch (error) {
  console.error(error?.code ?? 'INITIALIZATION_FAILED');
  process.exitCode = 1;
}

import { fileURLToPath } from 'node:url';
import { checkDatabaseIsolation } from './database-isolation-rules.ts';

const result = await checkDatabaseIsolation(
  fileURLToPath(new URL('..', import.meta.url)),
);
if (result.failures.length) {
  console.error(result.failures.join('\n'));
  process.exitCode = 1;
} else {
  console.info(
    `Database isolation passed: ${result.database}; ${result.files} source files, ${result.lockedPackages} locked packages.`,
  );
}

import { resolve } from 'node:path';
import { checkArchitecture } from './architecture-rules.ts';

const result = await checkArchitecture(resolve('src'));
if (result.failures.length) {
  console.error(result.failures.join('\n'));
  process.exitCode = 1;
} else {
  console.info(
    `Architecture passed: ${result.files} files, ${result.imports} imports, ${result.modules.length} features; file and feature graphs are acyclic.`,
  );
}

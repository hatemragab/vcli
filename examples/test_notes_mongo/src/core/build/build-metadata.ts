import { readFileSync } from 'node:fs';
function readBuildId(): string | null {
  let value: unknown;
  try {
    value = JSON.parse(
      readFileSync(
        new URL('../../build-metadata.json', import.meta.url),
        'utf8',
      ),
    );
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return null;
    // eslint-disable-next-line preserve-caught-error -- Exclude parsing/path details from startup failures.
    throw new Error('INVALID_BUILD_METADATA');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('schema' in value) ||
    value.schema !== 1 ||
    !('sourceCommit' in value) ||
    (value.sourceCommit !== null &&
      (typeof value.sourceCommit !== 'string' ||
        !/^[a-f0-9]{40}$/.test(value.sourceCommit)))
  )
    throw new Error('INVALID_BUILD_METADATA');
  return value.sourceCommit;
}
/** Immutable build asset; runtime environment cannot supply a deployment identity. */
export const buildId = readBuildId();

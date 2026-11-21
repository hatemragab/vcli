import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Evidence: installed bin/vcli.mjs shebang. This is not hosted-provider acceptance.
const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));

test('dry-run config-file reaches VCLI when the file is missing', () => {
  const child = spawnSync(
    executable,
    [
      '--json',
      '--project',
      'examples/test_notes_mongo',
      'dev',
      '--dry-run',
      '--config-file',
      '.env.missing',
    ],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' },
  );
  assert.notEqual(child.status, 9);
  assert.doesNotMatch(
    child.stderr ?? '',
    /Could not find|ENOENT: no such file/,
  );
  const result = JSON.parse(child.stdout) as {
    schemaVersion: number;
    status: string;
  };
  assert.equal(result.schemaVersion, 1);
  assert.notEqual(result.status, '');
});

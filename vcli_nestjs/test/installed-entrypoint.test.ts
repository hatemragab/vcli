import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Evidence: installed bin/vcli.mjs shebang. This is not hosted-provider acceptance.
const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));

test('dry-run config-file reaches VCLI when the file is missing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-installed-entrypoint-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const project = 'entrypoint-api';
  const options = {
    cwd: directory,
    encoding: 'utf8' as const,
    env: {
      ...process.env,
      PATH: [dirname(process.execPath), process.env.PATH]
        .filter(Boolean)
        .join(delimiter),
    },
  };
  const setup = spawnSync(
    executable,
    ['--json', 'init', project, '--yes', '--skip-install'],
    options,
  );
  assert.ifError(setup.error);
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);

  const child = spawnSync(
    executable,
    [
      '--json',
      '--project',
      project,
      'dev',
      '--dry-run',
      '--config-file',
      '.env.missing',
    ],
    options,
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.doesNotMatch(
    child.stderr ?? '',
    /Could not find|ENOENT: no such file/,
  );
  const result = JSON.parse(child.stdout) as {
    schemaVersion: number;
    status: string;
    operation: string;
    data: { project: string };
  };
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.status, 'preview');
  assert.equal(result.operation, 'dev');
  assert.equal(result.data.project, project);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Task-owned review artifacts, not deployment or provider provisioning.
const repository = resolve('.'),
  root = join(repository, 'var/generated-reviews');
const cache = join(root, 'cache'),
  archive = join(root, 'archive', String(Date.now()));
await mkdir(cache, { recursive: true, mode: 0o700 });
await mkdir(archive, { recursive: true, mode: 0o700 });
async function exists(path: string) {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}
async function execute(name: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [join(repository, 'bin/vcli.mjs'), ...args, '--json'],
    { cwd: repository, encoding: 'utf8', timeout: 240000, maxBuffer: 16000000 },
  );
  await writeFile(join(root, name + '.json'), result.stdout, { mode: 0o600 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'REVIEW_' + name.toUpperCase());
  const data = JSON.parse(result.stdout) as {
    status: string;
    data?: { changes?: unknown[]; outcomes?: unknown };
  };
  process.stdout.write(
    JSON.stringify({
      step: name,
      status: data.status,
      files: data.data?.changes?.length,
      outcomes: data.data?.outcomes,
    }) + '\n',
  );
}
for (const database of ['mongodb', 'postgres']) {
  const project = join(root, database + '-api'),
    dependencies = join(cache, database + '-node_modules'),
    lock = join(cache, database + '-package-lock.json');
  if (await exists(project)) {
    const configuration = JSON.parse(
      await readFile(join(project, 'vcli.json'), 'utf8'),
    ) as { project: { name: string } };
    assert.equal(configuration.project.name, database + '-api');
    if (await exists(join(project, 'node_modules'))) {
      assert.equal(await exists(dependencies), false);
      await rename(join(project, 'node_modules'), dependencies);
    }
    if (await exists(join(project, 'package-lock.json'))) {
      assert.equal(await exists(lock), false);
      await rename(join(project, 'package-lock.json'), lock);
    }
    await rename(project, join(archive, database + '-api'));
  }
  await execute(database + '-generation', [
    'init',
    project,
    '--name',
    database + '-api',
    '--database',
    database,
    '--auth',
    'firebase',
    '--firebase-methods',
    'email-password,phone,google,apple',
    '--action-delivery',
    'application',
    '--mail',
    'smtp',
    '--reliable-actions',
    '--storage',
    'aws-s3',
    '--media',
    '--upload-modes',
    'mediated,presigned,multipart',
    '--notes',
    '--push',
    'fcm,apns',
    '--realtime',
    'socket-io',
    '--diagnostics',
    '--evidence-sources',
    'application,workers,database,infrastructure,tests',
    '--test-evidence',
    '--diagnostic-reader',
    'restricted-remote-read',
    '--mcp',
    '--vector',
    '--logdy',
    '--deploy',
    'coolify',
    '--yes',
    '--skip-install',
  ]);
  if (await exists(dependencies))
    await rename(dependencies, join(project, 'node_modules'));
  if (await exists(lock))
    await rename(lock, join(project, 'package-lock.json'));
  await execute(database + '-install', [
    '--project',
    project,
    'install',
    '--offline',
  ]);
  await execute(database + '-check', ['--project', project, 'check']);
}

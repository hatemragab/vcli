#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// Coordinator acceptance wrapper only; a token is substituted into its private task copy.
const container = '__TASK_CONTAINER__';
const [tool, ...args] = process.argv.slice(2);
assert.ok(
  ['pg_dump', 'pg_restore', 'mongodump', 'mongorestore'].includes(tool),
);
assert.match(container, /^vcli-native-(postgres|mongodb)-[a-f0-9]{10}$/);
const directory = '/tmp/vcli-native-tools-' + randomUUID();
function docker(...command) {
  const result = spawnSync('/usr/bin/sudo', ['-n', 'docker', ...command], {
    env: { PATH: process.env.PATH, LANG: 'C' },
    stdio: 'ignore',
    timeout: 180000,
  });
  assert.equal(result.status, 0, 'PRIVATE_NATIVE_TOOL_OPERATION_FAILED');
}
async function file(path, exists = true) {
  const absolute = resolve(path);
  assert.ok(absolute.startsWith(resolve('var/cli-release/native-proof') + sep));
  if (exists) {
    const stat = await lstat(absolute);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(await realpath(absolute), absolute);
  }
  return absolute;
}
docker('exec', container, 'mkdir', '-m', '700', directory);
try {
  let archive;
  let output;
  const rewritten = [...args];
  const env = [];
  if (tool.startsWith('pg_')) {
    const credentials = await file(process.env.PGPASSFILE);
    docker('cp', credentials, container + ':' + directory + '/credentials');
    for (const key of [
      'PGHOST',
      'PGPORT',
      'PGDATABASE',
      'PGUSER',
      'PGSSLMODE',
      'PGCONNECT_TIMEOUT',
    ]) {
      if (process.env[key]) env.push('-e', key + '=' + process.env[key]);
    }
    env.push('-e', 'PGPASSFILE=' + directory + '/credentials');
    const index =
      tool === 'pg_dump' ? args.indexOf('--file') + 1 : args.length - 1;
    assert.ok(index > 0);
    archive = await file(args[index], tool === 'pg_restore');
    rewritten[index] = directory + '/archive';
    output = tool === 'pg_dump';
  } else {
    const index = args.indexOf('--config') + 1;
    assert.ok(index > 0);
    docker(
      'cp',
      await file(args[index]),
      container + ':' + directory + '/credentials',
    );
    rewritten[index] = directory + '/credentials';
    const archiveIndex = args.findIndex((arg) => arg.startsWith('--archive='));
    assert.ok(archiveIndex >= 0);
    archive = await file(
      args[archiveIndex].slice('--archive='.length),
      tool === 'mongorestore',
    );
    rewritten[archiveIndex] = '--archive=' + directory + '/archive';
    output = tool === 'mongodump';
  }
  docker('exec', container, 'chmod', '600', directory + '/credentials');
  if (!output) docker('cp', archive, container + ':' + directory + '/archive');
  docker('exec', ...env, container, tool, ...rewritten);
  if (output) docker('cp', container + ':' + directory + '/archive', archive);
} finally {
  docker('exec', container, 'rm', '-rf', directory);
}

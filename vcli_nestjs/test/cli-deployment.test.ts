import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { configuration } from '../dist/recipes/render-config.js';
import { describeServices } from '../dist/recipes/service-plan.js';
import { loadTargetProfile } from '../dist/deployment/operators/index.js';
import { snapshot as nativeSnapshot } from '../dist/deployment/operators/validation.js';
import type { ProjectConfig } from '../src/contracts.js';

const secret = 'PRIVATE_DEPLOYMENT_SENTINEL';
function invoke(directory: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [resolve('bin/vcli.mjs'), ...args, '--json'],
    { cwd: directory, encoding: 'utf8', timeout: 30000 },
  );
  assert.ifError(result.error);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    new RegExp(secret + '|' + directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  return {
    code: result.status,
    result: JSON.parse(lines[0]!) as {
      status: string;
      operation: string;
      data?: Record<string, unknown>;
      errors?: { code: string }[];
    },
  };
}
test('deployment discovery dry run validates a private profile without probing or creating journals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-deploy-command-'));
  try {
    const profile = join(directory, 'profile.json');
    await writeFile(
      profile,
      JSON.stringify({
        schemaVersion: 1,
        target: 'caprover',
        targetVersion: '1.16.0',
        origin: 'https://no-network.invalid',
        scope: {
          namespace: 'captain',
          projectId: 'fixture-project',
          environmentId: 'preprovisioned',
          serverId: 'captain',
          appName: 'fixture-api',
        },
        token: secret,
        journalDirectory: join(directory, 'journal'),
        environment: {},
        replaceEnvironmentKeys: [],
        exclusive: {
          quiesced: true,
          evidenceRef: 'fixture:exclusive',
          secretRevisionRef: 'fixture:secret-revision',
        },
      }),
      { mode: 0o600 },
    );
    const bytes = await readFile(profile);
    const result = invoke(directory, [
      'deploy',
      'discover',
      '--profile',
      profile,
      '--save-snapshot',
      join(directory, 'never.json'),
      '--dry-run',
    ]);
    assert.equal(result.code, 0);
    assert.equal(result.result.status, 'preview');
    assert.equal(result.result.data?.network, false);
    assert.equal(result.result.data?.saved, false);
    assert.deepEqual(await readdir(directory), ['profile.json']);
    assert.ok((await readFile(profile)).equals(bytes));
    await symlink(profile, join(directory, 'link.json'));
    const rejected = invoke(directory, [
      'deploy',
      'discover',
      '--profile',
      join(directory, 'link.json'),
      '--dry-run',
    ]);
    assert.equal(rejected.code, 1);
    assert.equal(rejected.result.status, 'failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('deployment command boundary refuses private malformed saved input before execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-deploy-invalid-'));
  try {
    const file = join(directory, 'invalid.json');
    await writeFile(
      file,
      JSON.stringify({ token: secret, origin: 'https://no-network.invalid' }),
      { mode: 0o600 },
    );
    for (const action of ['apply', 'inspect', 'verify', 'reconcile']) {
      const outcome = invoke(directory, [
        'deploy',
        action,
        '--plan',
        file,
        '--profile',
        file,
        '--dry-run',
        ...(action === 'reconcile' ? ['--decision', file] : []),
      ]);
      assert.equal(outcome.code, 1);
      assert.equal(outcome.result.status, 'failed');
    }
    assert.deepEqual(await readdir(directory), ['invalid.json']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('deployment plan requires actual selected resource bindings and explicit private save; apply preview never probes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-deploy-plan-'));
  try {
    const project = join(directory, 'api');
    const initialized = invoke(directory, [
      'init',
      project,
      '--name',
      'deployment-preview',
      '--database',
      'postgres',
      '--auth',
      'firebase',
      '--deploy',
      'dokploy',
      '--skip-install',
      '--yes',
    ]);
    assert.equal(initialized.code, 0);
    const config: ProjectConfig = JSON.parse(
      await readFile(join(project, 'vcli.json'), 'utf8'),
    );
    const fields = configuration(config).fields;
    const services = describeServices(config, fields, {
      environment: 'production',
      targetVersion: '0.31.3',
      externalResources: {
        'auth-redis': 'actual-auth-redis-1',
        database: 'actual-db-1',
        firebase: 'actual-firebase-1',
      },
      requireExternalResources: true,
    });
    const environment = Object.fromEntries(
      services.services
        .find((service) => service.id === 'api')!
        .environment.filter(
          (field) =>
            field.required || services.operatorReview.includes(field.key),
        )
        .map((field) => [field.key, field.secret ? secret : 'fixture-setting']),
    );
    Object.assign(environment, {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3100',
      PUBLIC_ORIGIN: 'https://api.example.invalid',
      ALLOWED_ORIGINS: 'https://api.example.invalid',
      REDIS_URL: `rediss://app:${secret}@redis.example.invalid:6379`,
    });
    const profileFile = join(directory, 'profile.json');
    await writeFile(
      profileFile,
      JSON.stringify({
        schemaVersion: 1,
        target: 'dokploy',
        targetVersion: '0.31.3',
        origin: 'https://no-network.invalid',
        scope: {
          namespace: 'org-1',
          projectId: 'project-1',
          environmentId: 'env-1',
          serverId: 'server-1',
          appName: 'deployment-preview-api',
        },
        token: secret,
        journalDirectory: join(directory, 'journal'),
        environment,
        replaceEnvironmentKeys: [],
        exclusive: {
          quiesced: true,
          evidenceRef: 'fixture:exclusive',
          secretRevisionRef: 'fixture:revision',
        },
      }),
      { mode: 0o600 },
    );
    const profile = await loadTargetProfile(profileFile);
    const snapshotFile = join(directory, 'snapshot.json'),
      releaseFile = join(directory, 'release.json'),
      planFile = join(directory, 'plan.json');
    await writeFile(snapshotFile, JSON.stringify(nativeSnapshot(profile, [])), {
      mode: 0o600,
    });
    await writeFile(
      releaseFile,
      JSON.stringify({
        operationId: '12345678-1234-4123-8123-123456789abc',
        sourceCommit: 'a'.repeat(40),
        image: 'registry.example.invalid/api@sha256:' + 'b'.repeat(64),
        schemaReleaseId: 'fixture-schema-release',
        readinessUrl: 'https://api.example.invalid/health/ready',
        managedEnvironmentKeys: Object.keys(environment).sort(),
        preconditions: {
          exclusiveRef: 'fixture:exclusive',
          secretRevisionRef: 'fixture:revision',
          ingressRef: 'fixture:private-ingress',
          externalResources: {
            'actual-auth-redis-1': 'fixture:auth-redis-proof',
            'actual-db-1': 'fixture:db-proof',
            'actual-firebase-1': 'fixture:firebase-proof',
          },
          volumes: {},
        },
      }),
      { mode: 0o600 },
    );
    const before = await readFile(join(project, 'vcli.lock.json'));
    const args = [
      '--project',
      project,
      'deploy',
      'plan',
      '--profile',
      profileFile,
      '--snapshot',
      snapshotFile,
      '--release',
      releaseFile,
      '--save-plan',
      planFile,
    ];
    assert.equal(
      invoke(directory, [...args, '--dry-run']).code,
      1,
      'missing real resource bindings deny before save',
    );
    const providerBindings = [
      ...args,
      '--resource',
      'database=actual-db-1',
      '--resource',
      'firebase=actual-firebase-1',
    ];
    assert.equal(
      invoke(directory, [...providerBindings, '--dry-run']).code,
      1,
      'auth Redis requires a distinct resource binding',
    );
    const bound = [
      ...providerBindings,
      '--resource',
      'auth-redis=actual-auth-redis-1',
    ];
    const preview = invoke(directory, [...bound, '--dry-run']);
    assert.equal(preview.code, 0, JSON.stringify(preview.result));
    assert.equal(preview.result.data?.saved, false);
    assert.equal((await readdir(directory)).includes('plan.json'), false);
    const saved = invoke(directory, bound);
    assert.equal(saved.code, 0);
    assert.equal(saved.result.data?.saved, true);
    assert.doesNotMatch(await readFile(planFile, 'utf8'), new RegExp(secret));
    const apply = invoke(directory, [
      'deploy',
      'apply',
      '--profile',
      profileFile,
      '--plan',
      planFile,
      '--dry-run',
    ]);
    assert.equal(apply.code, 0);
    assert.equal(apply.result.data?.network, false);
    assert.equal((await readdir(directory)).includes('journal'), false);
    assert.ok((await readFile(join(project, 'vcli.lock.json'))).equals(before));
    assert.equal(
      invoke(directory, bound).code,
      1,
      'explicit saved plan refuses overwrite',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

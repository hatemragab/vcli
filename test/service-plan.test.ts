import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectConfig } from '../src/contracts.ts';
import type { EnvironmentContribution } from '../src/recipes/render-config.ts';
import {
  describeServices,
  targetContracts,
} from '../dist/recipes/service-plan.js';
import { serviceEnvironment } from '../dist/recipes/render-deployment.js';
import { serviceFiles } from '../dist/recipes/render-services.js';

const fields: EnvironmentContribution[] = [
  { key: 'DATABASE_URL', required: true, secret: true },
  { key: 'SMTP_PASSWORD', required: false, secret: true },
  { key: 'SMTP_USER', required: false, secret: true },
  { key: 'SMTP_PORT', required: false, secret: false, defaultValue: '587' },
  {
    key: 'PUBLIC_ORIGIN',
    required: false,
    secret: false,
    defaultValue: 'https://api.example.invalid',
  },
];
const config = (...ids: string[]): ProjectConfig => ({
  schemaVersion: 1,
  project: { name: 'sample-api', packageManager: 'npm' },
  capabilities: Object.fromEntries(
    ['foundation.nest', ...ids].map((recipe) => [
      recipe.split('.')[0]!,
      { recipe, options: {} },
    ]),
  ),
});

test('finite plans are selected, deterministic, metadata-only and have closed references', () => {
  const selected = config(
    'database.postgres',
    'storage.local',
    'diagnostics.local',
    'mail.smtp',
  );
  selected.capabilities.mail!.options = { reliableActions: true };
  const first = describeServices(selected, fields);
  assert.deepEqual(
    first,
    describeServices(
      {
        ...selected,
        capabilities: Object.fromEntries(
          Object.entries(selected.capabilities).reverse(),
        ),
      },
      [...fields].reverse(),
    ),
  );
  assert.deepEqual(
    first.services.map((service) => service.id),
    ['api', 'database'],
  );
  assert.equal(first.jobs.length, 2);
  for (const service of first.services) {
    for (const id of service.dependsOn)
      assert.ok(first.services.some((candidate) => candidate.id === id));
    for (const id of service.volumes)
      assert.ok(first.volumes.some((volume) => volume.id === id));
    assert.ok(service.resources.memoryMiB > 0 && service.resources.cpus > 0);
  }
  assert.deepEqual(first.services[0]!.volumes, ['app-storage', 'app-evidence']);
  assert.equal(
    first.services.find((service) => service.id === 'database')!.ports[0]!
      .visibility,
    'loopback',
  );
  assert.equal(
    first.services.some((service) => service.kind === 'redis'),
    false,
  );
  assert.ok(
    first.jobs.every(
      (job) => job.scheduler === 'operator' && job.restart === 'no',
    ),
  );
});

test('staging selects production Node and separate stable resource identities', () => {
  const selected = config(
    'database.postgres',
    'mail.smtp',
    'deployment.dokploy',
  );
  const prod = describeServices(selected, fields),
    staging = describeServices(selected, fields, { environment: 'staging' });
  assert.equal(staging.nodeEnvironment, 'production');
  assert.notEqual(
    staging.services[0]!.resourceRef,
    prod.services[0]!.resourceRef,
  );
  assert.equal(staging.targetVersion, targetContracts.dokploy);
  assert.ok(staging.operatorReview.includes('MAIL_FROM'));
  assert.equal(staging.services[1]!.execution, 'external');
});

test('optional unset secrets are omitted/normalized; public origin requires operator review', () => {
  const values = serviceEnvironment(
    describeServices(config('deployment.coolify'), fields),
  );
  assert.equal(values.SMTP_PASSWORD, null);
  assert.equal(values.SMTP_USER, null);
  assert.equal(values.SMTP_PORT, '${SMTP_PORT:-587}');
  assert.match(values.DATABASE_URL!, /DATABASE_URL:\?/);
  assert.match(values.PUBLIC_ORIGIN!, /PUBLIC_ORIGIN:\?/);
  assert.throws(
    () =>
      describeServices(config(), [
        {
          key: 'SMTP_PASSWORD',
          required: false,
          secret: true,
          defaultValue: 'PRIVATE_SENTINEL',
        },
      ]),
    /INVALID_SERVICE_ENVIRONMENT_FIELD/,
  );
});

test('unknown versions, invalid profiles and production capture refuse before rendering', () => {
  for (const target of ['dokploy', 'coolify', 'caprover']) {
    assert.throws(
      () =>
        describeServices(config('deployment.' + target), fields, {
          targetVersion: '99.1.0',
        }),
      /UNSUPPORTED_TARGET_VERSION/,
    );
    assert.throws(
      () =>
        describeServices(
          config('mail.capture', 'deployment.' + target),
          fields,
        ),
      /UNSAFE_PRODUCTION_CAPTURE/,
    );
  }
  assert.throws(
    () => describeServices(config(), fields, { replicas: 2 }),
    /UNSUPPORTED_SERVICE_TOPOLOGY/,
  );
  assert.throws(
    () =>
      describeServices(config('deployment.caprover'), fields, {
        environment: 'development',
      }),
    /UNSUPPORTED_TARGET_ENVIRONMENT/,
  );
  assert.throws(
    () => describeServices(config(), fields, { cgroupParent: '../secret key' }),
    /INVALID_CGROUP_PARENT/,
  );
});

test('external refs are explicit nonsecret identities with missing/undeclared refusal', () => {
  const selected = config(
    'database.postgres',
    'mail.smtp',
    'deployment.caprover',
  );
  assert.throws(
    () =>
      describeServices(selected, fields, { requireExternalResources: true }),
    /MISSING_EXTERNAL_RESOURCE/,
  );
  assert.throws(
    () =>
      describeServices(selected, fields, {
        externalResources: { redis: 'new-resource' },
      }),
    /UNDECLARED_OR_INVALID_EXTERNAL_RESOURCE/,
  );
  assert.throws(
    () =>
      describeServices(selected, fields, {
        externalResources: { database: 'postgres://PRIVATE_SENTINEL@host/db' },
      }),
    /UNDECLARED_OR_INVALID_EXTERNAL_RESOURCE/,
  );
  const plan = describeServices(selected, fields, {
    requireExternalResources: true,
    externalResources: { database: 'pg-staging-01', smtp: 'smtp-account-01' },
  });
  assert.equal(
    plan.externalRequirements.every((item) => item.resourceRef !== undefined),
    true,
  );
});

test('eligible realtime cluster uses shared native DB; only Centrifugo requires Redis', () => {
  for (const transport of ['socket-io', 'centrifugo']) {
    const selected = config(
      'database.postgres',
      'realtime.' + transport,
      'deployment.caprover',
    );
    selected.capabilities.realtime!.options = { scale: 'cluster' };
    const plan = describeServices(selected, fields);
    assert.equal(plan.topology, 'cluster');
    assert.equal(plan.replicas, 2);
    assert.equal(
      plan.services.find((service) => service.id === 'database')!.execution,
      'external',
    );
    assert.equal(
      plan.services.some((service) => service.id === 'redis'),
      transport === 'centrifugo',
    );
    assert.equal(plan.volumes.length, 0);
    const generated = serviceFiles(selected, fields);
    const local = JSON.parse(
      generated.find((file) => file.path.endsWith('service-plan.json'))!
        .content,
    ) as { topology: string; services: { id: string; execution: string }[] };
    assert.equal(local.topology, 'cluster');
    assert.equal(local.services[1]!.execution, 'external');
  }
});

test('scale rejects private storage/evidence, native-ws, mismatch and unbounded replicas', () => {
  for (const extra of [
    'storage.local',
    'storage.aws-s3',
    'storage.r2',
    'diagnostics.local',
  ]) {
    const selected = config('database.postgres', 'realtime.socket-io', extra);
    selected.capabilities.realtime!.options = { scale: 'cluster' };
    assert.throws(
      () => describeServices(selected, fields),
      /UNSUPPORTED_SERVICE_TOPOLOGY/,
    );
  }
  const native = config('database.postgres', 'realtime.native-ws');
  native.capabilities.realtime!.options = { scale: 'cluster' };
  assert.throws(
    () => describeServices(native, fields),
    /UNSUPPORTED_SERVICE_TOPOLOGY/,
  );
  assert.throws(
    () =>
      describeServices(
        config('database.postgres', 'realtime.socket-io'),
        fields,
        { topology: 'cluster' },
      ),
    /REALTIME_TOPOLOGY_MISMATCH/,
  );
  assert.throws(
    () =>
      describeServices(config('database.postgres'), fields, {
        topology: 'cluster',
        replicas: 100,
      }),
    /UNSUPPORTED_SERVICE_TOPOLOGY/,
  );
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertDownloadBudget,
  buildOperationArguments,
  operationBuildLimits,
  redactOperationOutput,
  validateOperationImageAlias,
} from '../scripts/verify-generated-operations.ts';

test('real operations gate bounds classic build CPU/memory and reports best-effort PID limitation honestly', () => {
  const args = buildOperationArguments(
    '/task/project',
    'vcli-operations-0123456789',
    '3'.repeat(40),
  );
  for (const [flag, value] of [
    ['--cgroup-parent', 'orca.slice'],
    ['--memory', '768m'],
    ['--memory-swap', '768m'],
    ['--cpu-quota', '100000'],
    ['--cpu-period', '100000'],
    ['--ulimit', 'nproc=256:256'],
  ] as const)
    assert.equal(args[args.indexOf(flag) + 1], value);
  assert.equal(operationBuildLimits.hardBuildPids, false);
  assert.ok(args.includes('--force-rm'));
  assert.ok(args.includes('--pull=false'));
});
test('operations gate refuses unknown identity or an unapproved large combined download batch', () => {
  assert.throws(
    () => buildOperationArguments('/task', 'other-user-image', '3'.repeat(40)),
    /INVALID_OPERATION_IMAGE_IDENTITY/,
  );
  assert.throws(
    () =>
      buildOperationArguments(
        '/task',
        'vcli-operations-0123456789',
        'private-value',
      ),
    /INVALID_OPERATION_IMAGE_IDENTITY/,
  );
  assert.throws(
    () => assertDownloadBudget(350000000, 150000000),
    /DOWNLOAD_AUTHORIZATION_REQUIRED/,
  );
  assert.throws(() => assertDownloadBudget(Number.NaN, 100));
  assert.ok(assertDownloadBudget(100000000, 90000000) < 500000000);
  assert.throws(
    () => validateOperationImageAlias('sha256:foreign', 'sha256:expected'),
    /EXISTING_IMAGE_ALIAS_CONFLICT/,
  );
  assert.doesNotThrow(() => validateOperationImageAlias('', 'sha256:expected'));
});
test('private gate logs redact overlapping values and token-shaped unknown JWTs', () => {
  const values = ['PRIVATE_SENTINEL_WITH_LONG_SUFFIX', 'PRIVATE_SENTINEL'];
  const input = values.join(' ') + ' eyJtest.longtoken.payload';
  const safe = redactOperationOutput(input, values);
  assert.equal(safe.includes('PRIVATE_SENTINEL'), false);
  assert.equal(safe.includes('eyJtest'), false);
  assert.equal(safe.includes('LONG_SUFFIX'), false);
});
test(
  'actual generated image/services/dev evidence remains opt-in and requires every real gate result',
  { skip: !process.env.VCLI_GENERATED_OPERATIONS_EVIDENCE },
  async () => {
    const file = process.env.VCLI_GENERATED_OPERATIONS_EVIDENCE!;
    const report = JSON.parse(await readFile(file, 'utf8')) as {
      status: string;
      records: { name: string; exitCode: number | null }[];
      facts: {
        imageAudit: {
          uid: number;
          roots0700: boolean;
          authCopied: boolean;
          devCliAbsent: boolean;
        };
        dev: {
          ready: boolean;
          redisAuthLogin: boolean;
          sentinelSurvived: boolean;
          portReleased: boolean;
        };
        imageRestart: { nativeRowsPreserved: boolean };
      };
    };
    assert.equal(report.status, 'passed');
    for (const name of [
      'install-packed-cli',
      'install-generated',
      'check-generated',
      'build-generated',
      'download-estimate',
      'production-image-build',
      'production-image-audit',
      'image-redis-shared-fixture',
      'image-explicit-release',
      'image-native-argon-seed',
      'image-health-jose-native-notes-restart',
      'services-real-isolation-preservation',
      'actual-dev-owned-shutdown-and-json-refusal',
      'redis-rate-fixture-cleanup',
    ])
      assert.ok(
        report.records.some(
          (record) => record.name === name && record.exitCode === 0,
        ),
        name,
      );
    assert.equal(report.facts.imageAudit.uid, 1000);
    assert.equal(report.facts.imageAudit.roots0700, true);
    assert.equal(report.facts.imageAudit.authCopied, true);
    assert.equal(report.facts.imageAudit.devCliAbsent, true);
    assert.equal(report.facts.imageRestart.nativeRowsPreserved, true);
    assert.equal(report.facts.dev.ready, true);
    assert.equal(report.facts.dev.redisAuthLogin, true);
    assert.equal(report.facts.dev.sentinelSurvived, true);
    assert.equal(report.facts.dev.portReleased, true);
  },
);

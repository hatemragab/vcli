import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  nativeVectorConfig,
  runDiagnosticServices,
  validateDiagnosticBrowserEvidence,
} from '../scripts/verify-diagnostic-services.ts';

test('native diagnostic topology translation keeps loopback and sanitization boundaries', async () => {
  const selected = await readFile(
    'templates/runtime/common/ops/diagnostics/vector.yaml',
    'utf8',
  );
  const native = nativeVectorConfig(
    selected,
    '/task/evidence',
    '/task/checkpoints',
    12345,
  );
  assert(native.includes('address: 127.0.0.1:12345'));
  assert(native.includes('expected_prefix = "/task/evidence/"'));
  assert(native.includes('drop_on_error: true'));
  assert(native.includes('drop_on_abort: true'));
  assert(!native.includes('\ntests:'));
  assert(!native.includes('host.docker.internal'));
  assert.throws(() =>
    nativeVectorConfig(
      selected,
      '/task/unsafe"path',
      '/task/checkpoints',
      12345,
    ),
  );
});

test('browser evidence requires fresh successful scoped DOM checks and a closed browser', () => {
  const evidence = {
    passed: true,
    tool: 'existing Playwright MCP only',
    project: 'diagnostic-postgres',
    recordsObserved: 100,
    sources: ['application', 'workers', 'database', 'infrastructure', 'tests'],
    secretAbsent: true,
    foreignProjectAbsent: true,
    browserClosed: true,
  };
  assert.equal(
    validateDiagnosticBrowserEvidence(evidence, 'diagnostic-postgres').passed,
    true,
  );
  for (const change of [
    { passed: false },
    { project: 'foreign' },
    { secretAbsent: false },
    { browserClosed: false },
    { sources: ['application'] },
    { recordsObserved: 0 },
  ])
    assert.throws(() =>
      validateDiagnosticBrowserEvidence(
        { ...evidence, ...change },
        'diagnostic-postgres',
      ),
    );
});

test(
  'actual selected diagnostic services, retained readers and stdio MCP',
  {
    timeout: 360000,
    skip:
      !process.env.VECTOR_BINARY || !process.env.LOGDY_BINARY
        ? 'Set reviewed native Vector/Logdy binaries; no service is started implicitly'
        : false,
  },
  async () => {
    const report = await runDiagnosticServices({
      vectorBinary: resolve(process.env.VECTOR_BINARY!),
      logdyBinary: resolve(process.env.LOGDY_BINARY!),
      browserHold: process.env.DIAGNOSTIC_BROWSER_HOLD === '1',
      privateProxyAddress: process.env.DIAGNOSTIC_PRIVATE_PROXY_ADDRESS,
    });
    assert.equal(
      report.passed,
      true,
      report.error ?? 'See diagnostic service report',
    );
    assert.equal(report.cleanup, true);
    assert(report.cases.every((step) => step.passed));
  },
);

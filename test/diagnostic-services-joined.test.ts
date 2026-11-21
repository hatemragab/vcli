import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  diagnosticProbeSources,
  runJoinedDiagnosticServices,
} from '../scripts/verify-diagnostic-services.ts';

test('joined probe remains fixture-only with explicit configured native and diagnostic imports', () => {
  const files = diagnosticProbeSources(randomUUID());
  assert.equal(Object.keys(files).length, 5);
  assert(
    files['src/app.custom.module.ts']!.includes(
      'capabilities.database,capabilities.diagnostics',
    ),
  );
  assert(
    files['src/modules/diagnostic-probe/diagnostic-probe.service.ts']!.includes(
      'this.database.run(context=>this.database.context(context).execute',
    ),
  );
  assert(!/ModuleRef|@Global|forwardRef/.test(Object.values(files).join('\n')));
});

test(
  'actual generated HTTP/native PostgreSQL joins retained Vector Logdy and stdio MCP evidence',
  {
    timeout: 300000,
    skip:
      process.env.DIAGNOSTIC_JOINED !== '1'
        ? 'Explicit opt-in starts one task-owned capped cached PostgreSQL container'
        : false,
  },
  async () => {
    assert(process.env.VECTOR_BINARY && process.env.LOGDY_BINARY);
    const report = await runJoinedDiagnosticServices({
      vectorBinary: process.env.VECTOR_BINARY,
      logdyBinary: process.env.LOGDY_BINARY,
      browserHold: process.env.DIAGNOSTIC_BROWSER_HOLD === '1',
    });
    assert.equal(
      report.passed,
      true,
      report.error ?? 'See joined diagnostic report',
    );
    assert.equal(report.cleanup, true);
  },
);

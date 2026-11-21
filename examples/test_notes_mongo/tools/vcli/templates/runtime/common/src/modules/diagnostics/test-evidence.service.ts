import { z } from 'zod';
import type { DiagnosticEvents } from '../../core/diagnostics/diagnostic-events.js';
import { testReportSchema, type TestReport } from './test-result-schema.js';

const scopeSchema = z.strictObject({ runId: z.uuid(), operationId: z.uuid() });
/** Root's ordinary test runner owns process launch and handles; MCP cannot reach this class. */
export class TestEvidenceService {
  constructor(private readonly sink: DiagnosticEvents) {}
  async capture(
    scope: z.infer<typeof scopeSchema>,
    execute: () => Promise<TestReport>,
    hooks: Readonly<{
      flush: () => Promise<boolean>;
      stopOwned: () => Promise<boolean>;
      deadlineMs?: number;
    }>,
  ) {
    scopeSchema.parse(scope);
    const deadline = hooks.deadlineMs ?? 1000;
    if (!Number.isInteger(deadline) || deadline < 10 || deadline > 5000)
      throw new Error('INVALID_CAPTURE_DEADLINE');
    let report: TestReport;
    let outcome: 'passed' | 'failed' | 'aborted';
    try {
      const parsed = testReportSchema.safeParse(await execute());
      if (!parsed.success) {
        report = {
          assertions: [
            {
              check: 'custom',
              ordinal: 0,
              outcome: 'failed',
              code: 'INVALID_REPORT',
            },
          ],
          artifacts: [],
        };
        outcome = 'aborted';
      } else {
        report = parsed.data;
        outcome = report.assertions.some(
          (assertion) => assertion.outcome === 'failed',
        )
          ? 'failed'
          : report.assertions.length &&
              report.assertions.some(
                (assertion) => assertion.outcome === 'passed',
              )
            ? 'passed'
            : 'aborted';
      }
    } catch {
      report = {
        assertions: [
          {
            check: 'custom',
            ordinal: 0,
            outcome: 'failed',
            code: 'ASSERTION_FAILED',
          },
        ],
        artifacts: [],
      };
      outcome = 'failed';
    }
    const cleanupComplete = await this.bounded(hooks.stopOwned, deadline);
    const logsComplete = await this.bounded(hooks.flush, deadline);
    const testResult = { ...report, outcome, logsComplete, cleanupComplete };
    try {
      this.sink.record({
        event: 'test.result',
        severity: outcome === 'passed' ? 'info' : 'error',
        source: 'tests',
        ...scope,
        testResult,
      });
    } catch {
      return { ...testResult, resultRetained: false };
    }
    const resultRetained = await this.bounded(hooks.flush, deadline);
    return { ...testResult, resultRetained };
  }
  private async bounded(
    work: () => Promise<boolean>,
    milliseconds: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve()
          .then(work)
          .catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}

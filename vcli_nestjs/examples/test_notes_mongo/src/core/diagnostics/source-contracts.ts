import { z } from 'zod';
import { diagnosticInputSchema } from '../logging/log-event-schema.js';

export const diagnosticSources = [
  'application',
  'workers',
  'database',
  'infrastructure',
  'tests',
] as const;
export const diagnosticSourceSchema = z.enum(diagnosticSources);
export type DiagnosticSource = z.infer<typeof diagnosticSourceSchema>;
export type EvidenceConfig = Readonly<{
  directory: string;
  maxBytes: number;
  maxFiles: number;
  maxAgeMs?: number;
}>;
export const evidenceIdentitySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/);

/** A source is derived from its event, never from an untrusted source label. */
export function eventSource(
  event: z.infer<typeof diagnosticInputSchema>,
): DiagnosticSource {
  if (event.event === 'source.status') return event.source ?? 'application';
  if (event.event.startsWith('job.')) return 'workers';
  if (event.event.startsWith('database.')) return 'database';
  if (event.event === 'infrastructure.sampled') return 'infrastructure';
  if (event.event === 'test.result') return 'tests';
  return 'application';
}

export const sourceInputSchema = diagnosticInputSchema.superRefine(
  (event, context) => {
    const source = eventSource(event);
    if (event.source && event.source !== source)
      context.addIssue({ code: 'custom', message: 'SOURCE_MISMATCH' });
    if (source === 'workers' && event.event !== 'source.status' && !event.job)
      context.addIssue({ code: 'custom', message: 'JOB_REQUIRED' });
    if (
      source === 'database' &&
      event.event !== 'source.status' &&
      (!event.database || !event.databaseOperation)
    )
      context.addIssue({ code: 'custom', message: 'DATABASE_FACTS_REQUIRED' });
    if (event.event === 'infrastructure.sampled' && !event.infrastructure)
      context.addIssue({ code: 'custom', message: 'SAMPLE_REQUIRED' });
    if (
      event.event === 'test.result' &&
      (!event.runId || !event.operationId || !event.testResult)
    )
      context.addIssue({ code: 'custom', message: 'RESULT_SCOPE_REQUIRED' });
    if (
      event.event !== 'source.status' &&
      (event.dropped !== undefined || event.malformed !== undefined)
    )
      context.addIssue({ code: 'custom', message: 'STATUS_FACTS_ONLY' });
    if (event.testResult) {
      const failed = event.testResult.assertions.some(
        (assertion) => assertion.outcome === 'failed',
      );
      const passed = event.testResult.assertions.some(
        (assertion) => assertion.outcome === 'passed',
      );
      if (
        (event.testResult.outcome === 'passed' && (failed || !passed)) ||
        (event.testResult.outcome === 'failed' && !failed)
      )
        context.addIssue({
          code: 'custom',
          message: 'INCONSISTENT_ASSERTIONS',
        });
    }
    if (
      (event.testResult && event.event !== 'test.result') ||
      (event.infrastructure && event.event !== 'infrastructure.sampled') ||
      (event.job && !event.event.startsWith('job.')) ||
      ((event.database || event.databaseOperation) &&
        !event.event.startsWith('database.'))
    )
      context.addIssue({ code: 'custom', message: 'FOREIGN_SOURCE_FACTS' });
  },
);

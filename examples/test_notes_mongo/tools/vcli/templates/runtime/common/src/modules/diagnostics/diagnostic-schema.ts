import { z } from 'zod';
import { diagnosticInputSchema } from '../../core/logging/log-event-schema.js';
import {
  eventSource,
  sourceInputSchema,
} from '../../core/diagnostics/source-contracts.js';

export { diagnosticInputSchema };

export const diagnosticRecordSchema = diagnosticInputSchema
  .extend({
    version: z.literal(1),
    project: z.literal('generated-api'),
    service: z.literal('generated-api'),
    environment: z.enum(['development', 'test', 'production']),
    timestamp: z.iso.datetime(),
    writerId: z.uuid(),
    sequence: z.number().int().positive(),
  })
  .superRefine((record, context) => {
    const parsed = sourceInputSchema.safeParse(record);
    if (
      !parsed.success ||
      (record.source && record.source !== eventSource(record))
    )
      context.addIssue({ code: 'custom', message: 'INVALID_SOURCE_RECORD' });
  });
export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;
export { evidenceName } from './evidence-files.js';
export const logFilterSchema = z
  .strictObject({
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    event: diagnosticInputSchema.shape.event.optional(),
    source: diagnosticInputSchema.shape.source,
    severity: diagnosticInputSchema.shape.severity.optional(),
    requestId: z.uuid().optional(),
    operationId: z.uuid().optional(),
    runId: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().max(16384).optional(),
  })
  .refine(
    (value) =>
      !value.since ||
      !value.until ||
      Date.parse(value.until) >= Date.parse(value.since),
    'Invalid time range',
  )
  .refine(
    (value) =>
      !value.since ||
      !value.until ||
      Date.parse(value.until) - Date.parse(value.since) <= 86400000,
    'Maximum query window is 24 hours',
  );
export type LogFilter = z.infer<typeof logFilterSchema>;

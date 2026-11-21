import { z } from 'zod';
import { diagnosticInputSchema } from '../../core/logging/log-event-schema.js';

export { diagnosticInputSchema };

export const diagnosticRecordSchema = diagnosticInputSchema.extend({
  version: z.literal(1),
  project: z.literal('reference-api'),
  service: z.literal('reference-api'),
  environment: z.enum(['development', 'test', 'production']),
  timestamp: z.iso.datetime(),
  writerId: z.uuid(),
  sequence: z.number().int().positive(),
});
export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;
export const evidenceName = /^events-[0-9]{13}-[0-9a-f-]{36}\.jsonl$/;
export const logFilterSchema = z
  .strictObject({
    since: z.iso.datetime().optional(),
    until: z.iso.datetime().optional(),
    event: diagnosticInputSchema.shape.event.optional(),
    severity: diagnosticInputSchema.shape.severity.optional(),
    requestId: z.uuid().optional(),
    operationId: z.uuid().optional(),
    runId: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.string().max(8192).optional(),
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

import { z } from 'zod';
import { diagnosticInputSchema } from '../../core/logging/log-event-schema.js';

export const testResultQuerySchema = z.strictObject({
  runId: z.uuid(),
  operationId: z.uuid(),
  cursor: z.string().max(16384).optional(),
});
export const testReportSchema = diagnosticInputSchema.shape.testResult
  .unwrap()
  .pick({
    assertions: true,
    artifacts: true,
    revision: true,
    dirty: true,
    capabilities: true,
    versions: true,
  });
export type TestReport = z.infer<typeof testReportSchema>;

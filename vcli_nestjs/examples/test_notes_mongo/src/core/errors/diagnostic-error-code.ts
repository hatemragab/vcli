import type { DiagnosticEventInput } from '../diagnostics/diagnostic-events.js';
import { diagnosticInputSchema } from '../logging/log-event-schema.js';
import { ApplicationError } from './application-error.js';

/** Select a stable approved code without inspecting raw provider errors. */
export function diagnosticErrorCode(
  error: unknown,
  fallback: NonNullable<DiagnosticEventInput['errorCode']>,
): NonNullable<DiagnosticEventInput['errorCode']> {
  if (!(error instanceof ApplicationError)) return fallback;
  const parsed = diagnosticInputSchema.shape.errorCode.safeParse(error.code);
  return parsed.success && parsed.data ? parsed.data : fallback;
}

import type { z } from 'zod';
import type { diagnosticInputSchema } from '../logging/log-event-schema.js';

export type DiagnosticEventInput = Readonly<
  z.infer<typeof diagnosticInputSchema>
>;

/** Allowlisted facts only: no free-form messages, request bodies, headers or errors. */
export interface DiagnosticEvents {
  record(input: DiagnosticEventInput): void;
}
export const DIAGNOSTIC_EVENTS = Symbol('DiagnosticEvents');

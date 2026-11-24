import type { Request } from 'express';
import type { DiagnosticEventInput } from '../diagnostics/diagnostic-events.js';
import { diagnosticInputSchema as logEventSchema } from '../logging/log-event-schema.js';

/** Only registered allowlisted templates survive, never URLs, queries or params. */
export function requestFacts(
  request: Request,
): Pick<DiagnosticEventInput, 'method' | 'route'> {
  const candidate: unknown = request.route;
  const template =
    candidate &&
    typeof candidate === 'object' &&
    'path' in candidate &&
    typeof candidate.path === 'string'
      ? candidate.path.replace(/^\/api(?=\/|$)/, '')
      : undefined;
  const route = logEventSchema.shape.route.safeParse(template);
  const method = logEventSchema.shape.method.safeParse(request.method);
  return {
    ...(route.success && route.data ? { route: route.data } : {}),
    ...(method.success && method.data ? { method: method.data } : {}),
  };
}

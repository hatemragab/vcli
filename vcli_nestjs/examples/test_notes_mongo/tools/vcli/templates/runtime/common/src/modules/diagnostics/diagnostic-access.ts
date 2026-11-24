import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';

export const diagnosticGrantSchema = z.strictObject({
  project: z.literal('generated-api'),
  environment: z.enum(['development', 'test', 'production']),
  runs: z
    .array(
      z.strictObject({
        runId: z.uuid(),
        operationIds: z.array(z.uuid()).min(1).max(64),
      }),
    )
    .min(1)
    .max(32),
});
export type DiagnosticGrant = Readonly<z.infer<typeof diagnosticGrantSchema>>;
export function authorizeQuery(
  grant: DiagnosticGrant | undefined,
  query: { runId?: string; operationId?: string },
): void {
  if (!grant) return; // The same-user local profile deliberately grants all designated local evidence.
  const run = grant.runs.find((value) => value.runId === query.runId);
  if (
    !run ||
    (query.operationId && !run.operationIds.includes(query.operationId))
  )
    throw new ApplicationError('DIAGNOSTIC_SCOPE_DENIED', 403);
}
export function permitsEvent(
  grant: DiagnosticGrant | undefined,
  event: { runId?: string; operationId?: string },
): boolean {
  if (!grant) return true;
  return !!grant.runs.find(
    (run) =>
      run.runId === event.runId &&
      !!event.operationId &&
      run.operationIds.includes(event.operationId),
  );
}
export function grantScope(grant: DiagnosticGrant | undefined): string {
  return createHash('sha256')
    .update(JSON.stringify(grant ?? 'local-same-user'))
    .digest('hex');
}

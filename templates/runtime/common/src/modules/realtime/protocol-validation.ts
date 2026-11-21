import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { AccessProof, Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
export const accountEventSchema = z.strictObject({
  id: z.uuid(),
  type: z.string().regex(/^[a-z][a-z0-9.]{0,63}$/),
  payload: z.record(z.string().max(64), z.json()),
});
export const proofSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('local'),
    accessToken: z.string().min(1).max(8192),
  }),
  z.strictObject({
    kind: z.literal('firebase'),
    idToken: z.string().min(1).max(8192),
    sessionSecret: z.string().min(1).max(512),
  }),
]);
export function parseProof(
  input: unknown,
  driver: 'local' | 'firebase',
): AccessProof {
  const result = proofSchema.safeParse(input);
  if (!result.success || result.data.kind !== driver)
    throw new ApplicationError('UNAUTHENTICATED', 401);
  return result.data;
}
export async function withDeadline<T>(
  work: Promise<T>,
  milliseconds = 2000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ApplicationError('AUTHORITY_UNAVAILABLE', 503)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function recheckPrincipal(
  authority: PrincipalAuthority,
  original: Principal,
): Promise<Principal> {
  if (original.expiresAt <= Date.now())
    throw new ApplicationError('UNAUTHENTICATED', 401);
  const current = await withDeadline(authority.current(original.sessionId));
  if (
    current.accountId !== original.accountId ||
    current.sessionId !== original.sessionId ||
    current.installationId !== original.installationId ||
    current.installationGeneration !== original.installationGeneration ||
    current.expiresAt <= Date.now()
  )
    throw new ApplicationError('UNAUTHENTICATED', 401);
  return {
    ...current,
    expiresAt: Math.min(current.expiresAt, original.expiresAt),
  };
}
export const limits = Object.freeze({
  connections: 128,
  perSession: 8,
  pendingAdmissions: 32,
  messagesPerMinute: 60,
  authTimeoutMs: 3000,
  recheckMs: 1000,
  queuedBytes: 65536,
  concurrentPublishes: 8,
});

import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PushState } from './push.entity.js';
const destination = z
  .object({
    id: z.uuid(),
    generation: z.uuid(),
    accountId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
    installationId: z.string().min(1).max(256),
    installationGeneration: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    scope: z.string().min(1).max(4096),
    environment: z.enum(['sandbox', 'production']).default('sandbox'),
    provider: z.enum(['fcm', 'apns']),
    purpose: z.enum(['ordinary', 'background', 'voip']),
    platform: z.enum(['android', 'ios', 'web']),
    token: z.string().min(1).max(2048),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .transform((entry) => entry);
const state = z
  .object({
    revision: z.number().int().nonnegative(),
    destinations: z.array(destination).max(1024),
  })
  .strict();
export function decodePushState(value: unknown): PushState {
  const result = state.safeParse(value);
  if (!result.success)
    throw new ApplicationError('INVALID_PUSH_PERSISTENCE', 500);
  // A missing environment is also a legacy binding. Never infer eligibility.
  const raw = value as { destinations: Record<string, unknown>[] };
  return {
    ...result.data,
    destinations: result.data.destinations.map((entry, index) =>
      raw.destinations[index]?.environment === undefined
        ? { ...entry, installationGeneration: 0 }
        : entry,
    ),
  };
}

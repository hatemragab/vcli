import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { MediaOwnerState } from './media.entity.js';

const localProfile = z
  .object({
    version: z.literal(1),
    driver: z.literal('local'),
    root: z.string().min(1).max(4096),
  })
  .strict();
const s3Profile = z
  .object({
    version: z.literal(1),
    driver: z.literal('s3'),
    profile: z.enum(['aws', 'r2']),
    bucket: z.string().min(1).max(255),
    region: z.string().min(1).max(100),
    endpoint: z.url().optional(),
    forcePathStyle: z.boolean(),
  })
  .strict();
const evidence = z
  .object({
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    md5: z.string().min(1).max(64),
  })
  .strict();
const record = z
  .object({
    id: z.uuid(),
    ownerId: z.string().min(1).max(256),
    filename: z.string().min(1).max(128),
    bytes: z.number().int().positive().max(104857600),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    state: z.enum([
      'reserved',
      'receiving',
      'uploaded',
      'finalizing',
      'ready',
      'deleting',
      'failed',
    ]),
    stagingRoot: z.string().min(1).max(4096),
    profile: z.discriminatedUnion('driver', [localProfile, s3Profile]),
    evidence: evidence.optional(),
  })
  .strict();
const state = z
  .object({
    revision: z.number().int().nonnegative(),
    entries: z.array(record).max(128),
  })
  .strict();

export function decodeMediaState(
  value: unknown,
  ownerId: string,
): MediaOwnerState {
  const result = state.safeParse(value);
  if (
    !result.success ||
    result.data.entries.some((entry) => entry.ownerId !== ownerId)
  )
    throw new ApplicationError('INVALID_MEDIA_PERSISTENCE', 500);
  return result.data;
}

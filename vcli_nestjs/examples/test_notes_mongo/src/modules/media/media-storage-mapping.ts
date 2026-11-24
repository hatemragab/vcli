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
      'initiating',
      'multipart',
      'receiving',
      'uploaded',
      'finalizing',
      'ready',
      'deleting',
      'failed',
    ]),
    stagingRoot: z.string().min(1).max(4096),
    profile: localProfile,
    evidence: evidence.optional(),
    mode: z.enum(['mediated', 'presigned', 'multipart']).optional(),
    attemptId: z.uuid().optional(),
    generation: z.number().int().positive().optional(),
    claim: z
      .object({
        token: z.uuid(),
        kind: z.string().min(1).max(32),
        until: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    multipart: z
      .object({
        uploadId: z.string().min(1).max(2048).optional(),
        initiated: z.boolean(),
        partBytes: z.literal(8388608),
        parts: z
          .array(
            z
              .object({
                partNumber: z.number().int().min(1).max(13),
                bytes: z.number().int().positive().max(8388608),
                sha256: z.string().regex(/^[0-9a-f]{64}$/),
                status: z.enum(['declared', 'pending', 'complete']),
                etag: z.string().min(1).max(512).optional(),
                checksum: z.string().max(128).optional(),
              })
              .strict(),
          )
          .max(13),
      })
      .strict()
      .optional(),
    objectEvidence: z
      .object({
        bytes: z.number().int().positive(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        etag: z.string().min(1).max(512).optional(),
        versionId: z.string().min(1).max(2048).optional(),
      })
      .strict()
      .optional(),
    deleteAfter: z.number().int().nonnegative().optional(),
    stagingPending: z.boolean().optional(),
    stagingCleanupAt: z.number().int().nonnegative().optional(),
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

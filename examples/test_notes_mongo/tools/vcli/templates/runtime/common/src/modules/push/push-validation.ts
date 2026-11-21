import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PushMessage } from './push.entity.js';
export const pushRegistration = z
  .object({
    purpose: z.enum(['ordinary', 'background', 'voip']),
    platform: z.enum(['android', 'ios', 'web']),
    token: z
      .string()
      .min(16)
      .max(2048)
      .regex(/^[^\s\p{Cc}]+$/u),
  })
  .strict();
export const pushData = z.record(
  z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/)
    .refine((key) => !/^(from|gcm|google|aps|operationId)/i.test(key)),
  z.string().max(500),
);
const messageSchema = z
  .object({
    operationId: z.uuid(),
    purpose: z.enum(['ordinary', 'background', 'voip']),
    expiresAt: z.number().int().nonnegative(),
    title: z.string().min(1).max(100).optional(),
    body: z.string().min(1).max(500).optional(),
    data: pushData,
  })
  .strict();
export function validatePushMessage(message: PushMessage, now: number): void {
  if (
    !messageSchema.safeParse(message).success ||
    Object.keys(message.data).length > 12 ||
    Buffer.byteLength(JSON.stringify(message)) > 3000
  )
    throw new ApplicationError('INVALID_PUSH_MESSAGE', 400);
  if (
    message.purpose === 'voip' &&
    (!z.uuid().safeParse(message.data.callId).success ||
      message.title ||
      message.body)
  )
    throw new ApplicationError('VOIP_REQUIRES_CALL_ID', 400);
  if (message.purpose === 'background' && (message.title || message.body))
    throw new ApplicationError('BACKGROUND_PUSH_HAS_ALERT', 400);
  if (message.purpose === 'ordinary' && !message.title && !message.body)
    throw new ApplicationError('ORDINARY_PUSH_REQUIRES_ALERT', 400);
  if (message.expiresAt <= now || message.expiresAt > now + 300000)
    throw new ApplicationError('INVALID_PUSH_EXPIRY', 400);
}

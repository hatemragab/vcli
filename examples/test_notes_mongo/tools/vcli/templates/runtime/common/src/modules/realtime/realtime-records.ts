import { z } from 'zod';
export const principalSchema = z.strictObject({
  accountId: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  installationId: z.string().min(1).max(128),
  installationGeneration: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});
export const bindingSchema = z.strictObject({
  client: z.uuid(),
  principal: principalSchema,
  user: z.string().regex(/^[a-f0-9]{64}$/),
  channel: z.string().regex(/^private:[a-f0-9]{64}$/),
  expiresAt: z.number().int().positive(),
});
export type RealtimeRow = {
  _id: string;
  kind: 'ticket' | 'rate' | 'binding' | 'node' | 'lock';
  sessionId?: string;
  accountId?: string;
  purpose?: string;
  expiresAt: number;
  count?: number;
  data?: unknown;
};

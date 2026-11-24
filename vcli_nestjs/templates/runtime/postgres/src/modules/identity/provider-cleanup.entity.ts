import { pgTable, text, uuid, integer, bigint } from 'drizzle-orm/pg-core';
import type { ProviderCleanup } from './credential-ports.js';
export type { ProviderCleanup } from './credential-ports.js';
export const providerCleanupTable = pgTable('provider_cleanup', {
  id: uuid('id').primaryKey(),
  identityKey: text('identity_key').notNull(),
  generation: integer('generation').notNull(),
  action: text('action').$type<ProviderCleanup['action']>().notNull(),
  method: text('method'),
  status: text('status').$type<ProviderCleanup['status']>().notNull(),
  attempts: integer('attempts').notNull(),
  nextAttemptAt: bigint('next_attempt_at', { mode: 'number' }).notNull(),
  leaseId: uuid('lease_id'),
  leaseUntil: bigint('lease_until', { mode: 'number' }).notNull(),
  lastCode: text('last_code').$type<ProviderCleanup['lastCode']>().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
});

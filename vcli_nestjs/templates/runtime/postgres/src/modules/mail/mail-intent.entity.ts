import { bigint, integer, pgTable, text } from 'drizzle-orm/pg-core';
import type { MailIntent, MailIntentStatus } from './mail-intent-types.js';
export const mailIntentTable = pgTable('vcli_mail_intents', {
  id: text('id').primaryKey(),
  purpose: text('purpose').$type<MailIntent['purpose']>().notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  keyId: text('key_id').notNull(),
  payload: text('payload'),
  contentTag: text('content_tag').notNull(),
  status: text('status').$type<MailIntentStatus>().notNull(),
  attempts: integer('attempts').notNull(),
  fence: integer('fence').notNull(),
  leaseUntil: bigint('lease_until', { mode: 'number' }).notNull(),
  nextAttemptAt: bigint('next_attempt_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

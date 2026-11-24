import { bigint, integer, pgTable, uuid, text } from 'drizzle-orm/pg-core';
export type Installation = Readonly<{
  id: string;
  accountId: string;
  generation: number;
  capabilityHash: string | null;
  platform: 'android' | 'ios' | 'web' | 'other';
  createdAt: number;
}>;
export const installationTable = pgTable('ref_installations', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  generation: integer('generation').notNull(),
  capabilityHash: text('capability_hash').unique(),
  platform: text('platform').$type<Installation['platform']>().notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

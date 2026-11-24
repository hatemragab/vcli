import { boolean, bigint, pgTable, uuid, text } from 'drizzle-orm/pg-core';
export type Account = Readonly<{
  id: string;
  email: string | null;
  emailVerified: boolean;
  enabled: boolean;
  createdAt: number;
}>;
export const accountTable = pgTable('ref_accounts', {
  id: uuid('id').primaryKey(),
  email: text('email'),
  emailVerified: boolean('email_verified').notNull(),
  enabled: boolean('enabled').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

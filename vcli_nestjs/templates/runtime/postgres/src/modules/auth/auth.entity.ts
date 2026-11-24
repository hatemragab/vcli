import {
  bigint,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const authIdentifierIndex = 'basic_auth_accounts_identifier_unique';

export const authAccountsTable = pgTable(
  'basic_auth_accounts',
  {
    id: uuid('id').primaryKey(),
    identifier: varchar('identifier', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex(authIdentifierIndex).on(table.identifier)],
);

export type AuthAccount = Readonly<typeof authAccountsTable.$inferSelect>;

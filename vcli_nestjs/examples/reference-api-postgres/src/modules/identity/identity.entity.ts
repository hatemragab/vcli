import { bigint, integer, pgTable, uuid, text } from 'drizzle-orm/pg-core';
export type Identity = Readonly<{
  key: string;
  accountId: string;
  passwordHash: string | null;
  credentialVersion: number;
  enrollmentCutoff: number;
}>;
export type Action = Readonly<{
  hash: string;
  accountId: string;
  purpose: 'verification' | 'password-reset';
  credentialVersion: number;
  expiresAt: number;
  consumedAt: number | null;
}>;
export const identityTable = pgTable('ref_identities', {
  key: text('key').primaryKey(),
  accountId: uuid('account_id').notNull(),
  passwordHash: text('password_hash'),
  credentialVersion: integer('credential_version').notNull(),
  enrollmentCutoff: bigint('enrollment_cutoff', { mode: 'number' }).notNull(),
});
export const actionTable = pgTable('ref_actions', {
  hash: text('hash').primaryKey(),
  accountId: uuid('account_id').notNull(),
  purpose: text('purpose').$type<Action['purpose']>().notNull(),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  consumedAt: bigint('consumed_at', { mode: 'number' }),
});
export const rateTable = pgTable('ref_identity_rates', {
  key: text('key').primaryKey(),
  windowId: bigint('window_id', { mode: 'number' }).notNull(),
  used: integer('used').notNull(),
});

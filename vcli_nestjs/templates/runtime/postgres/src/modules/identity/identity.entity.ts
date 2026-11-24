import {
  bigint,
  boolean,
  jsonb,
  integer,
  pgTable,
  uuid,
  text,
} from 'drizzle-orm/pg-core';
export type Identity = Readonly<{
  key: string;
  accountId: string;
  passwordHash: string | null;
  credentialVersion: number;
  enrollmentCutoff: number;
  generation: number;
  active: boolean;
  methods: readonly string[];
  cleanupPending: boolean;
}>;
// vcli:begin email-actions
export type Action = Readonly<{
  hash: string;
  accountId: string;
  purpose: 'verification' | 'password-reset';
  credentialVersion: number;
  expiresAt: number;
  consumedAt: number | null;
}>;
// vcli:end email-actions
export const identityTable = pgTable('identities', {
  generation: integer('generation').notNull(),
  active: boolean('active').notNull(),
  methods: jsonb('methods').$type<readonly string[]>().notNull(),
  cleanupPending: boolean('cleanup_pending').notNull(),
  key: text('key').primaryKey(),
  accountId: uuid('account_id').notNull(),
  passwordHash: text('password_hash'),
  credentialVersion: integer('credential_version').notNull(),
  enrollmentCutoff: bigint('enrollment_cutoff', { mode: 'number' }).notNull(),
});
// vcli:begin email-actions
export const actionTable = pgTable('actions', {
  hash: text('hash').primaryKey(),
  accountId: uuid('account_id').notNull(),
  purpose: text('purpose').$type<Action['purpose']>().notNull(),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  consumedAt: bigint('consumed_at', { mode: 'number' }),
});
// vcli:end email-actions

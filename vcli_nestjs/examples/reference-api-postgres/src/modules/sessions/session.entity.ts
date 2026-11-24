import { bigint, pgTable, uuid, text } from 'drizzle-orm/pg-core';
export type Session = Readonly<{
  id: string;
  accountId: string;
  installationId: string;
  kind: 'local' | 'firebase';
  identityKey: string;
  method: string;
  secretHash: string | null;
  authenticatedAt: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}>;
export type Refresh = Readonly<{
  hash: string;
  sessionId: string;
  expiresAt: number;
  consumedAt: number | null;
}>;
export const sessionTable = pgTable('ref_sessions', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  installationId: uuid('installation_id').notNull(),
  kind: text('kind').$type<Session['kind']>().notNull(),
  identityKey: text('identity_key').notNull(),
  method: text('method').notNull(),
  secretHash: text('secret_hash').unique(),
  authenticatedAt: bigint('authenticated_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  revokedAt: bigint('revoked_at', { mode: 'number' }),
});
export const refreshTable = pgTable('ref_refresh', {
  hash: text('hash').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  consumedAt: bigint('consumed_at', { mode: 'number' }),
});

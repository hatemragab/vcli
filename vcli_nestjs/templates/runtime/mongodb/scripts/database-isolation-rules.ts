import { readdir, readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// This contributor check is fixed at generation time, never an app selector.
export const selectedDatabase = 'mongodb';
const requiredPackages = ['mongoose'];
const forbiddenPackages = new Set([
  'drizzle-orm',
  'drizzle-kit',
  'pg',
  'pg-native',
  '@types/pg',
  'pg-cloudflare',
  'pg-connection-string',
  'pg-int8',
  'pg-pool',
  'pg-protocol',
  'pg-types',
  'pgpass',
  'postgres',
  'postgres-array',
  'postgres-bytea',
  'postgres-date',
  'postgres-interval',
]);
// Shared utilities are allowed when reachable from a legitimate declared root.
// Keep the pinned opposite recipe's closure here so stale orphan entries fail too.
const sharedClosurePackages = new Set([
  '@types/node',
  'undici-types',
  'split2',
  'xtend',
]);
const oppositeSource = /(^|[./_-])(postgres(?:ql)?|drizzle|pg)(?=[./_-]|$)/i;
const oppositeSymbol =
  /^(Postgres|PostgreSQL|Drizzle|Pg)(Database|Repository|Schema|Client|Pool)/;

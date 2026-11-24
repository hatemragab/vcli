import { readdir, readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import ts from 'typescript';

// This contributor check is fixed at generation time, never an app selector.
export const selectedDatabase = 'postgres';
const requiredPackages = ['drizzle-orm', 'pg'];
const forbiddenPackages = new Set([
  'mongoose',
  '@types/mongoose',
  'mongodb',
  '@types/mongodb',
  '@mongodb-js/saslprep',
  'mongodb-connection-string-url',
  'bson',
  'kareem',
  'mpath',
  'mquery',
  'sift',
]);
// Shared utilities are allowed when reachable from a legitimate declared root.
// Keep the pinned opposite recipe's closure here so stale orphan entries fail too.
const sharedClosurePackages = new Set([
  '@standard-schema/spec',
  '@types/webidl-conversions',
  '@types/whatwg-url',
  'memory-pager',
  'sparse-bitfield',
  'ms',
  'punycode',
  'tr46',
  'webidl-conversions',
  'whatwg-url',
]);
const oppositeSource = /(^|[./_-])(mongo(?:db|ose)?)(?=[./_-]|$)/i;
const oppositeSymbol =
  /^(Mongo|MongoDB|Mongoose)(Database|Repository|Schema|Client|Pool)/;

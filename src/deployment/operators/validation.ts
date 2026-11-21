import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import type {
  DeploymentSnapshot,
  Json,
  ResourceSnapshot,
  TargetProfile,
} from './types.js';

export const versions = {
  dokploy: '0.31.3',
  coolify: '4.7.5',
  caprover: '1.16.0',
} as const;
export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
export const refSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/);
export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const imageSchema = z
  .string()
  .max(300)
  .regex(/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/);
export const keySchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
export const scopeSchema = z
  .object({
    namespace: idSchema,
    projectId: idSchema,
    environmentId: idSchema,
    serverId: idSchema,
    appName: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    resourceId: idSchema.optional(),
    nodeId: idSchema.optional(),
    destinationId: idSchema.optional(),
  })
  .strict();
const privateSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: z.enum(['dokploy', 'coolify', 'caprover']),
    origin: z.string(),
    targetVersion: z.string(),
    scope: scopeSchema,
    token: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[\x21-\x7e]+$/),
    journalDirectory: z
      .string()
      .min(1)
      .refine((v) => isAbsolute(v) && resolve(v) === v),
    environment: z.record(
      keySchema,
      z
        .string()
        .max(65536)
        .refine((v) => !v.includes('\0')),
    ),
    replaceEnvironmentKeys: z.array(keySchema).max(256),
    exclusive: z
      .object({
        quiesced: z.literal(true),
        evidenceRef: refSchema,
        secretRevisionRef: refSchema,
      })
      .strict(),
  })
  .strict();
export function fail(code: string): never {
  throw new Error(code);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_NATIVE_RESPONSE');
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1024)
    fail('INVALID_NATIVE_RESPONSE');
  return value;
}
export function identifier(value: unknown): string {
  const result = idSchema.safeParse(value);
  if (!result.success) fail('INVALID_NATIVE_ID');
  return result.data;
}
export function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function httpsUrl(value: string, originOnly = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('INVALID_HTTPS_TARGET');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (originOnly && url.pathname !== '/')
  )
    fail('INVALID_HTTPS_TARGET');
  if (originOnly && value !== url.origin) fail('INVALID_HTTPS_TARGET');
  return url;
}
export function validateProfile(input: unknown): TargetProfile {
  const result = privateSchema.safeParse(input);
  if (!result.success) fail('INVALID_PRIVATE_TARGET_PROFILE');
  const profile = result.data;
  httpsUrl(profile.origin, true);
  if (profile.targetVersion !== versions[profile.target])
    fail('UNSUPPORTED_TARGET_VERSION');
  if (
    profile.target === 'coolify' &&
    (!/^\d+$/.test(profile.scope.namespace) || !profile.scope.destinationId)
  )
    fail('INCOMPLETE_NATIVE_SCOPE');
  if (
    profile.target === 'caprover' &&
    (profile.scope.namespace !== 'captain' ||
      profile.scope.serverId !== 'captain' ||
      profile.scope.environmentId !== 'preprovisioned')
  )
    fail('UNSUPPORTED_CAPROVER_SCOPE');
  if (
    new Set(profile.replaceEnvironmentKeys).size !==
      profile.replaceEnvironmentKeys.length ||
    profile.replaceEnvironmentKeys.some(
      (k) => !Object.hasOwn(profile.environment, k),
    )
  )
    fail('INVALID_ENVIRONMENT_REPLACEMENT');
  return profile;
}
export function snapshot(
  profile: TargetProfile,
  resources: ResourceSnapshot[],
): DeploymentSnapshot {
  const body = {
    schemaVersion: 1 as const,
    target: profile.target,
    targetVersion: profile.targetVersion,
    origin: profile.origin,
    scope: profile.scope,
    resources: resources.sort((a, b) => a.id.localeCompare(b.id)),
  };
  return { ...body, fingerprint: digest(body) };
}
/** Parse only field names; never hash or return private values. Ambiguous dotenv requires manual setup. */
export function environmentLines(value: unknown): {
  lines: string[];
  keys: string[];
} {
  if (value === null || value === undefined || value === '')
    return { lines: [], keys: [] };
  if (typeof value !== 'string' || value.length > 512 * 1024)
    fail('AMBIGUOUS_PRIVATE_ENVIRONMENT');
  const lines = value.split('\n');
  const keys: string[] = [];
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^([A-Z][A-Z0-9_]{0,127})=([^\r\n]*)$/.exec(line);
    if (!m || keys.includes(m[1]!)) fail('AMBIGUOUS_PRIVATE_ENVIRONMENT');
    keys.push(m[1]!);
  }
  return { lines, keys: keys.sort() };
}
export function environmentRows(
  value: unknown,
): { key: string; value: string }[] {
  return list(value).map((raw) => {
    const row = record(raw);
    const key = keySchema.safeParse(row.key);
    if (!key.success || typeof row.value !== 'string')
      fail('AMBIGUOUS_PRIVATE_ENVIRONMENT');
    return { key: key.data, value: row.value };
  });
}
export function assertReplacement(
  profile: TargetProfile,
  existing: string[],
): void {
  for (const key of Object.keys(profile.environment))
    if (existing.includes(key) && !profile.replaceEnvironmentKeys.includes(key))
      fail('EXPLICIT_SECRET_REPLACEMENT_REQUIRED');
}
export function operationMarker(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^vcli-operation:([a-f0-9-]{36})$/.exec(value);
  return m?.[1] ?? null;
}
export function technical(
  raw: Record<string, unknown>,
  fields: readonly string[],
): { [key: string]: Json } {
  const result: { [key: string]: Json } = {};
  // Callers use ONLY known technical fields; arbitrary nested native objects are forbidden.
  for (const key of fields) {
    const v = raw[key];
    if (v === undefined || v === null) {
      result[key] = null;
      continue;
    }
    if (
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    ) {
      result[key] = v;
      continue;
    }
    if (typeof v === 'string' && v.length <= 512 && !/[\r\n]/.test(v)) {
      result[key] = v;
      continue;
    }
    fail('UNSUPPORTED_NATIVE_SETTINGS');
  }
  return result;
}

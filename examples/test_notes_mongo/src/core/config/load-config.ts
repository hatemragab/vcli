import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { ApplicationError } from '../errors/application-error.js';
const number = (fallback: number, maximum: number) =>
  z.coerce.number().int().positive().max(maximum).default(fallback);

const privateJson = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .max(16384)
    .transform((value, context): z.output<T> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'INVALID_PRIVATE_JSON' });
        return z.NEVER;
      }
      const result = schema.safeParse(parsed);
      if (!result.success) {
        context.addIssue({ code: 'custom', message: 'INVALID_PRIVATE_JSON' });
        return z.NEVER;
      }
      return result.data;
    });
const jwtKeySchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .refine((value) => {
      const key = Buffer.from(value, 'base64url');
      return key.byteLength === 32 && key.toString('base64url') === value;
    })
    .transform((value) => new Uint8Array(Buffer.from(value, 'base64url'))),
});
export const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: number(3100, 65535),
  PUBLIC_ORIGIN: z.url().default('http://127.0.0.1:3100'),
  ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:3100'),
  DATABASE_URL: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  SESSION_TTL_SECONDS: number(86400, 2592000),
  RECENT_AUTH_SECONDS: number(300, 900),
  JWT_KEYS_JSON: privateJson(z.array(jwtKeySchema).min(1).max(4)),
  JWT_ACTIVE_KID: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  JWT_MAX_LIFETIME_SECONDS: number(900, 86400),
  JWT_MAX_FUTURE_ISSUED_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(60)
    .default(0),
  JWT_ISSUER: z.string().min(1).default('app'),
  JWT_AUDIENCE: z.string().min(1).default('app-api'),
  ACCESS_TTL_SECONDS: number(300, 3600),
  LOCAL_STORAGE_ROOT: z.string().min(1).default('var/storage'),
  UPLOAD_MAX_BYTES: number(5242880, 104857600),
  UPLOAD_TTL_SECONDS: number(300, 900),
  EVIDENCE_DIRECTORY: z.string().min(1).default('var/evidence'),
  EVIDENCE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(512)
    .max(10485760)
    .default(1048576),
  EVIDENCE_MAX_FILES: number(3, 10),
  EVIDENCE_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(604800000)
    .default(86400000),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  for (const key of [
    'DATABASE_DRIVER',
    'AUTH_DRIVER',
    'STORAGE_DRIVER',
    'REALTIME_DRIVER',
    'MAIL_DRIVER',
  ])
    if (env[key] !== undefined)
      throw new ApplicationError('RUNTIME_PROVIDER_SELECTION_UNSUPPORTED', 500);
  const result = configSchema.safeParse(env);
  if (!result.success)
    throw new ApplicationError(
      'INVALID_CONFIG',
      500,
      'Invalid configuration keys: ' +
        result.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
  const e = result.data;
  if (
    new Set(e.JWT_KEYS_JSON.map((key) => key.id)).size !==
      e.JWT_KEYS_JSON.length ||
    new Set(
      e.JWT_KEYS_JSON.map((key) => Buffer.from(key.key).toString('base64url')),
    ).size !== e.JWT_KEYS_JSON.length ||
    !e.JWT_KEYS_JSON.some((key) => key.id === e.JWT_ACTIVE_KID) ||
    e.ACCESS_TTL_SECONDS > e.JWT_MAX_LIFETIME_SECONDS
  )
    throw new ApplicationError('INVALID_JWT_POLICY', 500);
  return {
    environment: e.NODE_ENV as 'development' | 'test' | 'production',
    host: e.HOST,
    port: e.PORT,
    publicOrigin: e.PUBLIC_ORIGIN,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',').map((value) =>
      z.url().parse(value.trim()),
    ),
    database: { driver: 'mongodb' as const, url: e.DATABASE_URL },
    auth: {
      driver: 'local' as const,
      sessionTtlSeconds: e.SESSION_TTL_SECONDS,
      recentAuthSeconds: e.RECENT_AUTH_SECONDS,
      identifier: 'username' as const,
      jwtPolicy: {
        issuer: e.JWT_ISSUER,
        audience: e.JWT_AUDIENCE,
        keys: e.JWT_KEYS_JSON,
        activeSigningKeyId: e.JWT_ACTIVE_KID,
        maxLifetimeSeconds: e.JWT_MAX_LIFETIME_SECONDS,
        maxFutureIssuedSeconds: e.JWT_MAX_FUTURE_ISSUED_SECONDS,
      },
      accessTtlSeconds: e.ACCESS_TTL_SECONDS,
    },
    storage: {
      driver: 'local' as const,
      localRoot: e.LOCAL_STORAGE_ROOT,
      maxBytes: e.UPLOAD_MAX_BYTES,
      uploadTtlSeconds: e.UPLOAD_TTL_SECONDS,
      modes: ['mediated'] as readonly (
        'mediated' | 'presigned' | 'multipart'
      )[],
    },
    diagnostics: {
      directory: e.EVIDENCE_DIRECTORY,
      maxBytes: e.EVIDENCE_MAX_BYTES,
      maxFiles: e.EVIDENCE_MAX_FILES,
      maxAgeMs: e.EVIDENCE_MAX_AGE_MS,
      sources: ['application', 'database', 'infrastructure'] as readonly (
        'application' | 'workers' | 'database' | 'infrastructure' | 'tests'
      )[],
    },
  };
}
export function loadSelectedEnvFile(): void {
  const path = process.env.APP_ENV_FILE;
  if (!path) return;
  if (process.env.NODE_ENV === 'production' && /development|test/.test(path))
    throw new ApplicationError('UNSAFE_ENV_FILE', 500);
  const result = loadDotenv({ path, override: false, quiet: true });
  if (result.error) throw new ApplicationError('ENV_FILE_UNAVAILABLE', 500);
}

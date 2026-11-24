import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { ApplicationError } from '../errors/application-error.js';
import type { AppConfig } from './app-config.js';
const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const number = (fallback: number, maximum: number) =>
  z.coerce.number().int().positive().max(maximum).default(fallback);
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: number(3100, 65535),
  PUBLIC_ORIGIN: z.url().default('http://127.0.0.1:3100'),
  ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:3100'),

  DATABASE_URL: z
    .string()
    .regex(/^mongodb(?:\+srv)?:\/\//)
    .default(
      'mongodb://127.0.0.1:57017/reference?replicaSet=rs0&directConnection=true',
    ),
  AUTH_DRIVER: z.enum(['local', 'firebase']).default('local'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_METHODS: z.string().default('password,phone,google.com,apple.com'),
  JWT_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  JWT_ISSUER: z.string().default('vcli-reference'),
  JWT_AUDIENCE: z.string().default('vcli-reference-api'),
  ACCESS_TTL_SECONDS: number(300, 3600),
  SESSION_TTL_SECONDS: number(86400, 2592000),
  RECENT_AUTH_SECONDS: number(300, 900),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_ROOT: z.string().default('var/storage'),
  UPLOAD_MAX_BYTES: number(5242880, 104857600),
  UPLOAD_TTL_SECONDS: number(300, 900),
  S3_PROFILE: z.enum(['aws', 'r2', 'custom']).default('aws'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: flag,
  REALTIME_DRIVER: z.enum(['socketio', 'ws', 'centrifugo']).default('socketio'),
  REALTIME_PATH: z.string().default('/realtime'),
  REALTIME_MAX_PAYLOAD_BYTES: number(16384, 1048576),
  REALTIME_TICKET_TTL_SECONDS: number(30, 60),
  CENTRIFUGO_API_URL: z.url().optional(),
  CENTRIFUGO_API_KEY: z.string().optional(),
  CENTRIFUGO_PROXY_SECRET: z.string().optional(),
  MAIL_DRIVER: z.enum(['capture', 'smtp']).default('capture'),
  MAIL_FROM: z.email().default('reference@example.invalid'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: number(587, 65535),
  SMTP_SECURE: flag,
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_CAPTURE_MAX: number(100, 1000),
  FCM_ENABLED: flag,
  APNS_ENABLED: flag,
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_KEY_PATH: z.string().optional(),
  APNS_TOPIC: z.string().optional(),
  APNS_PRODUCTION: flag,
  EVIDENCE_DIRECTORY: z.string().default('var/evidence'),
  EVIDENCE_MAX_BYTES: number(1048576, 10485760),
  EVIDENCE_MAX_FILES: number(3, 10),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.DATABASE_DRIVER !== undefined)
    throw new ApplicationError('LEGACY_DATABASE_SELECTION_UNSUPPORTED', 500);
  const result = schema.safeParse(env);
  if (!result.success)
    throw new ApplicationError(
      'INVALID_CONFIG',
      500,
      `Invalid configuration keys: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  const e = result.data;
  if (e.NODE_ENV === 'production' && !env.DATABASE_URL)
    throw new ApplicationError('DATABASE_URL_REQUIRED', 500);
  const required = (condition: boolean, value: unknown, key: string) => {
    if (condition && !value)
      throw new ApplicationError(
        'MISSING_CONFIG',
        500,
        `Missing required configuration: ${key}`,
      );
  };

  required(
    e.AUTH_DRIVER === 'firebase',
    e.FIREBASE_PROJECT_ID,
    'FIREBASE_PROJECT_ID',
  );
  required(e.STORAGE_DRIVER === 's3', e.S3_BUCKET, 'S3_BUCKET');
  required(e.MAIL_DRIVER === 'smtp', e.SMTP_HOST, 'SMTP_HOST');
  required(
    e.REALTIME_DRIVER === 'centrifugo',
    e.CENTRIFUGO_API_URL && e.CENTRIFUGO_API_KEY && e.CENTRIFUGO_PROXY_SECRET,
    'CENTRIFUGO_API_URL / API_KEY / PROXY_SECRET',
  );
  required(
    e.APNS_ENABLED,
    e.APNS_TEAM_ID && e.APNS_KEY_ID && e.APNS_KEY_PATH && e.APNS_TOPIC,
    'APNS_TEAM_ID / KEY_ID / KEY_PATH / TOPIC',
  );
  if (e.NODE_ENV === 'production' && e.MAIL_DRIVER === 'capture')
    throw new ApplicationError('UNSAFE_PRODUCTION_PROFILE', 500);
  required(
    e.NODE_ENV === 'production' && e.AUTH_DRIVER === 'local',
    e.JWT_SECRET,
    'JWT_SECRET',
  );
  const methods = z
    .array(z.enum(['password', 'phone', 'google.com', 'apple.com']))
    .min(1)
    .safeParse(e.FIREBASE_METHODS.split(',').map((v) => v.trim()));
  if (!methods.success)
    throw new ApplicationError(
      'INVALID_CONFIG',
      500,
      'Invalid FIREBASE_METHODS',
    );
  return {
    environment: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    publicOrigin: e.PUBLIC_ORIGIN,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',').map((v) =>
      z.url().parse(v.trim()),
    ),
    database: { driver: 'mongodb', url: e.DATABASE_URL },
    auth: {
      driver: e.AUTH_DRIVER,
      firebaseProjectId: e.FIREBASE_PROJECT_ID,
      firebaseMethods: methods.data,
      jwtSecret: e.JWT_SECRET,
      issuer: e.JWT_ISSUER,
      audience: e.JWT_AUDIENCE,
      accessTtlSeconds: e.ACCESS_TTL_SECONDS,
      sessionTtlSeconds: e.SESSION_TTL_SECONDS,
      recentAuthSeconds: e.RECENT_AUTH_SECONDS,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      localRoot: e.LOCAL_STORAGE_ROOT,
      maxBytes: e.UPLOAD_MAX_BYTES,
      uploadTtlSeconds: e.UPLOAD_TTL_SECONDS,
      s3Profile: e.S3_PROFILE,
      bucket: e.S3_BUCKET,
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    realtime: {
      driver: e.REALTIME_DRIVER,
      path: e.REALTIME_PATH,
      maxPayloadBytes: e.REALTIME_MAX_PAYLOAD_BYTES,
      ticketTtlSeconds: e.REALTIME_TICKET_TTL_SECONDS,
      centrifugoApiUrl: e.CENTRIFUGO_API_URL,
      centrifugoApiKey: e.CENTRIFUGO_API_KEY,
      centrifugoProxySecret: e.CENTRIFUGO_PROXY_SECRET,
    },
    mail: {
      driver: e.MAIL_DRIVER,
      from: e.MAIL_FROM,
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      maxCaptured: e.MAIL_CAPTURE_MAX,
    },
    push: {
      fcmEnabled: e.FCM_ENABLED,
      apnsEnabled: e.APNS_ENABLED,
      apnsTeamId: e.APNS_TEAM_ID,
      apnsKeyId: e.APNS_KEY_ID,
      apnsKeyPath: e.APNS_KEY_PATH,
      apnsTopic: e.APNS_TOPIC,
      apnsProduction: e.APNS_PRODUCTION,
    },
    diagnostics: {
      directory: e.EVIDENCE_DIRECTORY,
      maxBytes: e.EVIDENCE_MAX_BYTES,
      maxFiles: e.EVIDENCE_MAX_FILES,
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

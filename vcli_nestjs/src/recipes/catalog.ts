import {
  TOOL_VERSION,
  validationFailure,
  type JsonObject,
  type Recipe,
  type RecipeCatalog,
} from '../contracts.js';
import { renderProject } from './render-project.js';

const version = TOOL_VERSION;
const methods = ['email-password', 'phone', 'google', 'apple'] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_RECIPE_OPTIONS');
  return value as Record<string, unknown>;
}
function emptyOptions(value: unknown): JsonObject {
  if (Object.keys(object(value)).length)
    throw new Error('UNSUPPORTED_RECIPE_OPTIONS');
  return {};
}
function localOptions(value: unknown): JsonObject {
  const input = object(value);
  if (
    Object.keys(input).some(
      (key) => !['identifier', 'profile', 'redisDocker'].includes(key),
    ) ||
    (input.identifier !== undefined &&
      input.identifier !== 'email' &&
      input.identifier !== 'username')
  )
    throw new Error('UNSUPPORTED_LOCAL_IDENTIFIER');
  if (
    input.profile !== undefined &&
    input.profile !== 'basic' &&
    input.profile !== 'full'
  )
    throw validationFailure(
      'INVALID_OPTIONS',
      'Choose basic or full for the local authentication profile.',
      { recipe: 'auth.local', option: 'profile' },
    );
  // Omitted profile retains the full auth configuration used by existing locks.
  return {
    ...(input.identifier === 'username' ? { identifier: 'username' } : {}),
    ...(input.profile === 'basic' ? { profile: 'basic' } : {}),
    ...redisDockerOption(input),
  };
}
function redisDockerOption(input: Record<string, unknown>): JsonObject {
  if (input.redisDocker !== undefined && typeof input.redisDocker !== 'boolean')
    throw new Error('INVALID_REDIS_DOCKER_OPTION');
  return input.redisDocker ? { redisDocker: true } : {};
}
function firebaseOptions(value: unknown): JsonObject {
  const input = object(value);
  if (
    Object.keys(input).some(
      (key) => !['methods', 'actionDelivery', 'redisDocker'].includes(key),
    )
  )
    throw new Error('UNSUPPORTED_FIREBASE_MODE');
  if (
    input.actionDelivery !== undefined &&
    !['provider', 'application'].includes(String(input.actionDelivery))
  )
    throw new Error('INVALID_FIREBASE_ACTION_DELIVERY');
  const selected = input.methods ?? [...methods];
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some(
      (method) =>
        typeof method !== 'string' ||
        !methods.includes(method as (typeof methods)[number]),
    ) ||
    new Set(selected).size !== selected.length
  )
    throw new Error('INVALID_FIREBASE_METHODS');
  return {
    methods: methods.filter((method) => selected.includes(method)),
    actionDelivery:
      input.actionDelivery === 'application' ? 'application' : 'provider',
    ...redisDockerOption(input),
  };
}
function mailOptions(value: unknown): JsonObject {
  const input = object(value);
  if (
    Object.keys(input).some((key) => key !== 'reliableActions') ||
    (input.reliableActions !== undefined &&
      typeof input.reliableActions !== 'boolean')
  )
    throw new Error('INVALID_MAIL_OPTIONS');
  return { reliableActions: input.reliableActions === true };
}
function httpMailOptions(value: unknown): JsonObject {
  const input = object(value);
  if (input.provider !== undefined && input.provider !== 'resend')
    throw new Error('UNSUPPORTED_HTTP_MAIL_PROVIDER');
  const rest = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'provider'),
  );
  return { ...mailOptions(rest), provider: 'resend' };
}
function diagnosticsOptions(value: unknown): JsonObject {
  const input = object(value);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          'mcp',
          'vector',
          'logdy',
          'sources',
          'testCapture',
          'reader',
        ].includes(key),
    )
  )
    throw new Error('UNSUPPORTED_DIAGNOSTICS_OPTIONS');
  for (const key of ['mcp', 'vector', 'logdy', 'testCapture'])
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new Error('INVALID_DIAGNOSTICS_OPTIONS');
  const order = [
    'application',
    'workers',
    'database',
    'infrastructure',
    'tests',
  ];
  const sources = input.sources ?? ['application'];
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.some((source) => !order.includes(String(source))) ||
    new Set(sources).size !== sources.length
  )
    throw new Error('INVALID_DIAGNOSTIC_SOURCES');
  const reader = input.reader ?? 'local-same-user';
  if (!['local-same-user', 'restricted-remote-read'].includes(String(reader)))
    throw new Error('UNSUPPORTED_DIAGNOSTIC_READER');
  if (input.testCapture === true && !sources.includes('tests'))
    throw new Error('TEST_CAPTURE_REQUIRES_TESTS_SOURCE');
  if (!sources.includes('application'))
    throw new Error('APPLICATION_DIAGNOSTICS_REQUIRED');
  return {
    mcp: input.mcp === true,
    vector: input.vector === true,
    logdy: input.logdy === true,
    sources: order.filter((source) => sources.includes(source)),
    testCapture: input.testCapture === true,
    reader: String(reader),
  };
}
function mediaOptions(value: unknown): JsonObject {
  const input = object(value);
  if (Object.keys(input).some((key) => key !== 'modes'))
    throw new Error('INVALID_MEDIA_OPTIONS');
  const order = ['mediated', 'presigned', 'multipart'];
  const modes = input.modes ?? ['mediated'];
  if (
    !Array.isArray(modes) ||
    !modes.length ||
    modes.some((mode) => !order.includes(String(mode))) ||
    new Set(modes).size !== modes.length
  )
    throw new Error('INVALID_UPLOAD_MODES');
  return { modes: order.filter((mode) => modes.includes(mode)) };
}
function realtimeOptions(value: unknown): JsonObject {
  const input = object(value);
  if (
    Object.keys(input).some((key) => key !== 'scale') ||
    (input.scale !== undefined &&
      !['single-instance', 'cluster'].includes(String(input.scale)))
  )
    throw new Error('UNSUPPORTED_REALTIME_PROFILE');
  return { scale: input.scale === 'cluster' ? 'cluster' : 'single-instance' };
}
function recipe(
  id: string,
  family: string,
  requires: string[] = ['foundation'],
  validateOptions = emptyOptions,
): Recipe {
  return { id, version, family, requires, conflicts: [], validateOptions };
}
/** Curated, trusted recipes. Provider replacement requires an explicit migration. */
export const recipes: readonly Recipe[] = [
  recipe('foundation.nest', 'foundation', []),
  recipe('database.mongodb', 'database'),
  recipe('database.postgres', 'database'),
  recipe('auth.local', 'auth', ['foundation', 'database'], localOptions),
  recipe('auth.firebase', 'auth', ['foundation', 'database'], firebaseOptions),
  recipe('mail.capture', 'mail', ['foundation'], mailOptions),
  recipe('mail.smtp', 'mail', ['foundation'], mailOptions),
  recipe('mail.http', 'mail', ['foundation'], httpMailOptions),
  recipe('storage.local', 'storage'),
  recipe('storage.aws-s3', 'storage'),
  recipe('storage.r2', 'storage'),
  recipe('example.notes', 'notes', ['foundation', 'database', 'auth']),
  recipe(
    'media.private',
    'media',
    ['foundation', 'database', 'auth', 'storage'],
    mediaOptions,
  ),
  recipe('push.fcm', 'push-fcm', ['foundation', 'database', 'auth']),
  recipe('push.apns', 'push-apns', ['foundation', 'database', 'auth']),
  recipe(
    'realtime.socket-io',
    'realtime',
    ['foundation', 'auth'],
    realtimeOptions,
  ),
  recipe(
    'realtime.native-ws',
    'realtime',
    ['foundation', 'auth'],
    realtimeOptions,
  ),
  recipe(
    'realtime.centrifugo',
    'realtime',
    ['foundation', 'auth'],
    realtimeOptions,
  ),
  recipe(
    'diagnostics.local',
    'diagnostics',
    ['foundation'],
    diagnosticsOptions,
  ),
  recipe('deployment.dokploy', 'deployment'),
  recipe('deployment.coolify', 'deployment'),
  recipe('deployment.caprover', 'deployment'),
];
export const recipeCatalog: RecipeCatalog = { recipes, render: renderProject };

import {
  projectNameSchema,
  validationFailure,
  type ProjectConfig,
  type Recipe,
} from '../contracts.js';
export function selection(
  config: ProjectConfig,
  family: string,
): string | undefined {
  return config.capabilities[family]?.recipe;
}
export function usernameAuth(config: ProjectConfig): boolean {
  return (
    selection(config, 'auth') === 'auth.local' &&
    config.capabilities.auth?.options.identifier === 'username'
  );
}
export function basicLocalAuth(config: ProjectConfig): boolean {
  return (
    selection(config, 'auth') === 'auth.local' &&
    config.capabilities.auth?.options.profile === 'basic'
  );
}

export function validateAuthCompatibility(config: ProjectConfig): void {
  const auth = selection(config, 'auth');
  const basic = basicLocalAuth(config);
  if (auth === 'auth.firebase' || (auth === 'auth.local' && !basic)) return;

  const advanced = [
    ['media', 'Private media'],
    ['push-fcm', 'FCM push'],
    ['push-apns', 'APNs push'],
    ['realtime', 'Realtime'],
    ['notes', 'The notes example'],
  ] as const;
  for (const [family, label] of advanced) {
    const recipe = selection(config, family);
    if (recipe)
      throw validationFailure(
        basic ? 'INVALID_OPTIONS' : 'MISSING_CAPABILITY',
        `${label} requires full local auth or Firebase. Remove this capability or use --auth local --local-auth-profile full or --auth firebase when initializing the project.`,
        { recipe, option: 'profile' },
      );
  }
}

export function validateSelection(
  config: ProjectConfig,
  resolved: readonly Recipe[],
): void {
  if (!projectNameSchema.safeParse(config.project.name).success)
    throw new Error('INVALID_PROJECT_NAME');
  if (selection(config, 'foundation') !== 'foundation.nest')
    throw new Error('FOUNDATION_REQUIRED');
  validateAuthCompatibility(config);
  if (
    selection(config, 'auth') === 'auth.local' &&
    !basicLocalAuth(config) &&
    !usernameAuth(config) &&
    !selection(config, 'mail')
  )
    throw new Error('MISSING_CAPABILITY:mail');
  for (const [family, selected] of Object.entries(config.capabilities)) {
    const recipe = resolved.find(
      (item) => item.id === selected.recipe && item.family === family,
    );
    if (!recipe) throw new Error('UNKNOWN_OR_UNRESOLVED_RECIPE');
    recipe.validateOptions(selected.options);
    for (const required of recipe.requires)
      if (!config.capabilities[required])
        throw new Error(`MISSING_CAPABILITY:${required}`);
    for (const conflict of recipe.conflicts)
      if (resolved.some((item) => item.id === conflict))
        throw new Error('RECIPE_CONFLICT');
  }
  if (
    resolved.length !== Object.keys(config.capabilities).length ||
    new Set(resolved.map((r) => r.family)).size !== resolved.length
  )
    throw new Error('RESOLVED_RECIPE_MISMATCH');
  if (
    config.capabilities.mail?.options.reliableActions === true &&
    !selection(config, 'database')
  )
    throw new Error('RELIABLE_MAIL_REQUIRES_DATABASE');
  if (
    config.capabilities.auth?.options.actionDelivery === 'application' &&
    (!selection(config, 'mail') ||
      config.capabilities.mail?.options.reliableActions !== true)
  )
    throw new Error('FIREBASE_APPLICATION_ACTIONS_REQUIRE_RELIABLE_MAIL');
  const modes = config.capabilities.media?.options.modes ?? ['mediated'];
  if (
    Array.isArray(modes) &&
    modes.some((mode) => mode !== 'mediated') &&
    selection(config, 'storage') === 'storage.local'
  )
    throw new Error('LOCAL_STORAGE_REQUIRES_MEDIATED_UPLOAD');
  if (
    Array.isArray(modes) &&
    modes.includes('presigned') &&
    selection(config, 'storage') !== 'storage.aws-s3'
  )
    throw new Error('PRESIGNED_POST_REQUIRES_AWS');
  const sources = config.capabilities.diagnostics?.options.sources;
  if (
    selection(config, 'realtime') === 'realtime.native-ws' &&
    config.capabilities.realtime?.options.scale === 'cluster'
  )
    throw new Error('NATIVE_WS_CLUSTER_UNSUPPORTED');
  if (
    Array.isArray(sources) &&
    sources.includes('database') &&
    !selection(config, 'database')
  )
    throw new Error('DATABASE_DIAGNOSTICS_REQUIRE_DATABASE');
}

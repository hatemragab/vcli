import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled } from './bundle.js';
import { selection } from './selection.js';

export async function basicAuthFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const database =
    selection(config, 'database') === 'database.mongodb'
      ? 'mongodb'
      : 'postgres';
  const prefix = 'src/modules/auth/';
  const limiter = await bundled(
    'src/modules/identity/redis-identity-rate-store.ts',
  );
  return Promise.all([
    ...[
      'auth-inputs.ts',
      'auth-token.service.ts',
      'auth.controller.ts',
      'auth.guard.ts',
      'auth.service.ts',
      'auth.module.ts',
    ].map((name) => bundled(prefix + name)),
    ...[
      'core/auth/auth-runtime-error.ts',
      'core/auth/password-input.ts',
      'core/http/parse-input.ts',
    ].map((name) => bundled('src/' + name)),
    ...['auth.entity.ts', 'auth.repository.ts', 'initialize-auth.ts'].map(
      (name) => bundled(prefix + name, database),
    ),
    { ...limiter, path: prefix + 'redis-identity-rate-store.ts' },
  ]);
}

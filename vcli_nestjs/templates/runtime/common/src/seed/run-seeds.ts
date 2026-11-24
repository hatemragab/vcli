import 'reflect-metadata';
import { loadConfig } from '../core/config/load-config.js';
import { openDatabase } from '../core/database/database.js';
import type { ModuleSeed } from '../core/database/module-seeder.js';
import { SeedError } from '../core/database/seed-error.js';
import { ApplicationError } from '../core/errors/application-error.js';
import { assertSelectedReleaseReady } from '../generated/selected-release.js';
import {
  requiresIdentitySchema,
  selectedSeeders,
} from '../generated/selected-seeders.js';
import { customSeeders } from './custom-seeders.js';

const moduleName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const schemaAction =
  'Apply the selected schema with make release-apply CONFIG_FILE=<file> using the same development/test database. See ops/release/README.md for incomplete attempts.';
const actions = {
  SEED_ARGUMENTS_INVALID:
    'Run npm run db:seed or npm run db:seed -- --module <name>. Use a lowercase feature name.',
  SEED_REGISTRY_INVALID:
    'Give each seeder a unique lowercase module name and a run function in src/seed/custom-seeders.ts, then rebuild.',
  SEED_CONFIG_INVALID:
    'Run npm exec -- vcli config check with the same development/test configuration and fix the reported keys.',
  SEED_DATABASE_UNAVAILABLE:
    'Start the selected development/test database and check DATABASE_URL and credentials.',
  MONGODB_TRANSACTION_TOPOLOGY_REQUIRED:
    'Use a writable MongoDB replica set or sharded deployment.',
  SEED_SCHEMA_NOT_READY: schemaAction,
  SEED_FIXTURES_NOT_IMPLEMENTED:
    'Implement fixtures through the owning feature service before running its registered seeder.',
  COMMIT_OUTCOME_UNKNOWN:
    'Check the fixture records for this module before retrying the seed command.',
} as const;

function resolveSeeders(args: readonly string[]): readonly ModuleSeed[] {
  const requested = args[1];
  if (
    args.length !== 0 &&
    (args.length !== 2 ||
      args[0] !== '--module' ||
      !requested ||
      requested.length > 64 ||
      !moduleName.test(requested))
  )
    throw new ApplicationError('SEED_ARGUMENTS_INVALID');
  const registry = new Map<string, ModuleSeed>();
  for (const seed of [...selectedSeeders, ...customSeeders]) {
    if (
      !seed ||
      typeof seed.module !== 'string' ||
      seed.module.length > 64 ||
      !moduleName.test(seed.module) ||
      typeof seed.run !== 'function' ||
      registry.has(seed.module)
    )
      throw new ApplicationError('SEED_REGISTRY_INVALID');
    registry.set(seed.module, seed);
  }
  if (requested === undefined) return [...registry.values()];
  const seed = registry.get(requested);
  if (seed) return [seed];
  const names = [...registry.keys()].join(', ') || 'none';
  throw new SeedError(
    'SEED_MODULE_UNREGISTERED',
    `Registered modules: ${names}. Check src/seed/custom-seeders.ts and rebuild after changes.`,
  );
}

function fail(code: string, action: string, module?: string): void {
  console.error(`${module ? module + ': ' : ''}${code}: ${action}`);
  process.exitCode = 1;
}

export async function runSeeds(args: readonly string[]): Promise<void> {
  let stage: 'config' | 'database' | 'schema' | 'fixtures' = 'config';
  let module: string | undefined;
  try {
    const seeders = resolveSeeders(args);
    if (!seeders.length) {
      console.log('No development/test seeders are registered.');
      return;
    }
    const config = loadConfig();
    stage = 'database';
    const database = await openDatabase(config, requiresIdentitySchema);
    try {
      stage = 'schema';
      await assertSelectedReleaseReady(database);
      stage = 'fixtures';
      for (const seed of seeders) {
        module = seed.module;
        const { created, alreadyPresent } = await seed.run(database);
        console.log(
          `${module}: created=${created} already-present=${alreadyPresent}`,
        );
      }
    } finally {
      await database.close().catch(() => {
        fail(
          'SEED_CLOSE_FAILED',
          'Check the database connection before retrying.',
        );
      });
    }
  } catch (error) {
    if (error instanceof SeedError) {
      fail(error.code, error.message, module);
      return;
    }
    if (error instanceof ApplicationError) {
      if (Object.hasOwn(actions, error.code)) {
        fail(error.code, actions[error.code as keyof typeof actions], module);
        return;
      }
    }
    const code = error instanceof ApplicationError ? error.code : undefined;
    const sqlCause =
      error && typeof error === 'object' && 'cause' in error
        ? error.cause
        : error;
    const missingTable =
      sqlCause &&
      typeof sqlCause === 'object' &&
      'code' in sqlCause &&
      sqlCause.code === '42P01';
    if (
      stage === 'schema' ||
      missingTable ||
      code === 'DATABASE_INITIALIZATION_REQUIRED'
    )
      fail('SEED_SCHEMA_NOT_READY', actions.SEED_SCHEMA_NOT_READY, module);
    else if (stage === 'config')
      fail('SEED_CONFIG_INVALID', actions.SEED_CONFIG_INVALID);
    else if (stage === 'database' || code === 'DATABASE_UNAVAILABLE')
      fail(
        'SEED_DATABASE_UNAVAILABLE',
        actions.SEED_DATABASE_UNAVAILABLE,
        module,
      );
    else
      fail(
        'SEED_MODULE_FAILED',
        'Check the owning feature seeder and its fixture prerequisites, then retry.',
        module,
      );
  }
}

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  canonical,
  checkSchema,
  configSchema,
  hash,
  hashSchema,
  idSchema,
  json,
  outcomesSchema,
  parseJson,
  rejectPrivateValues,
  TOOL_VERSION,
  validateConfig,
} from './data.js';
import { EngineError } from './engine-error.js';
import {
  assertNoSymlinks,
  contained,
  hasFileAncestor,
  readRegular,
  relativePath,
} from './paths.js';
import { recipeVersionSchema, validateLock } from './state.js';
import type { GenerationPlan } from './types.js';
import {
  getSourceMigration,
  previewSourceMigration,
} from './source-migrations.js';
import { managedRegion, validatePackageFields } from './managed-content.js';

const expectedSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('absent') }).strict(),
  z.object({ kind: z.literal('hash'), hash: hashSchema }).strict(),
]);
const planSchema = z
  .object({
    schemaVersion: z.literal(1),
    toolVersion: z.literal(TOOL_VERSION),
    id: idSchema,
    kind: z.enum(['init', 'add', 'scaffold', 'upgrade']),
    workspaceDir: z.string(),
    projectDir: z.string(),
    config: configSchema,
    recipes: z.array(recipeVersionSchema),
    changes: z.array(
      z
        .object({
          path: z.string(),
          ownership: z.enum(['managed', 'scaffold']),
          expected: expectedSchema,
          content: z.string().max(16_000_000),
          hash: hashSchema,
        })
        .strict(),
    ),
    guards: z.array(
      z.object({ path: z.string(), expected: expectedSchema }).strict(),
    ),
    checks: z.array(checkSchema),
    warnings: z.array(z.string()),
    pending: z.array(z.string()),
    outcomes: outcomesSchema,
    initialEntries: z.array(z.literal('.git')).optional(),
    developmentDefaults: z
      .record(
        z.string().regex(/^[A-Z][A-Z0-9_]{0,64}$/),
        z
          .string()
          .min(1)
          .max(4096)
          .regex(/^[\x20-\x7e]+$/)
          .refine((value) => !/['`#]/.test(value)),
      )
      .optional(),
    sourceMigrations: z
      .array(
        z
          .object({
            id: z.string(),
            path: z.string(),
            expectedHash: hashSchema,
            resultHash: hashSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
/** Validates every serialized path and metadata before even creating an operation lock. */
export function validatePlan(input: unknown): GenerationPlan {
  const result = planSchema.safeParse(input);
  if (!result.success)
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Use a current private plan produced by this CLI version.',
    );
  const plan = result.data;
  rejectPrivateValues(plan.config);
  if (
    !path.isAbsolute(plan.projectDir) ||
    !path.isAbsolute(plan.workspaceDir) ||
    path.resolve(plan.projectDir) !== plan.projectDir ||
    path.resolve(plan.workspaceDir) !== plan.workspaceDir
  )
    throw new EngineError(
      'UNSAFE_PATH',
      'validation',
      'Use normalized absolute plan roots.',
    );
  contained(plan.workspaceDir, plan.projectDir);
  if (plan.kind === 'init' && !plan.initialEntries)
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Init plans must declare their permitted initial entries.',
    );
  if (plan.kind !== 'init' && plan.initialEntries)
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Use initial-directory preconditions only for init.',
    );
  if (
    plan.developmentDefaults &&
    (plan.kind !== 'init' ||
      plan.developmentDefaults.NODE_ENV !== 'development' ||
      [
        'JWT_KEYS_JSON',
        'JWT_ACTIVE_KID',
        'MAIL_DELIVERY_KEYS_JSON',
        'MAIL_DELIVERY_KEY_ID',
        'CENTRIFUGO_API_KEY',
        'CENTRIFUGO_PROXY_SECRET',
      ].some((key) => Object.hasOwn(plan.developmentDefaults!, key)))
  )
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Use public development defaults only in new project plans.',
    );
  const paths = new Set<string>();
  for (const change of plan.changes) {
    relativePath(change.path);
    if (
      change.path === 'package-lock.json' ||
      paths.has(change.path) ||
      hash(change.content) !== change.hash ||
      Buffer.byteLength(change.content) > 16_000_000
    )
      throw new EngineError(
        'INVALID_PLAN',
        'validation',
        'Use unique paths with valid postimage hashes.',
      );
    if (
      change.ownership === 'scaffold' &&
      change.expected.kind !== 'absent' &&
      !plan.sourceMigrations?.some(
        (migration) => migration.path === change.path,
      )
    )
      throw new EngineError(
        'INVALID_PLAN',
        'validation',
        'Developer scaffold paths can only be created once.',
      );
    paths.add(change.path);
  }
  if (hasFileAncestor(paths))
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'A generated file cannot also be a directory.',
    );
  for (const guard of plan.guards) relativePath(guard.path);
  if (
    plan.kind === 'init' &&
    (plan.changes.some((change) => change.expected.kind !== 'absent') ||
      !paths.has('vcli.json'))
  )
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Init must create new paths and desired metadata.',
    );
  if (
    plan.kind !== 'init' &&
    !['vcli.json', 'vcli.lock.json', 'package.json'].every((file) =>
      plan.guards.some(
        (guard) => guard.path === file && guard.expected.kind === 'hash',
      ),
    )
  )
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Existing-project plans require configuration, state and package preconditions.',
    );
  const migrationIds = new Set<string>();
  for (const migration of plan.sourceMigrations ?? []) {
    const definition = getSourceMigration(migration.id);
    const change = plan.changes.find((file) => file.path === migration.path);
    relativePath(migration.path);
    if (
      plan.kind !== 'upgrade' ||
      definition.path !== migration.path ||
      migrationIds.has(migration.id) ||
      !change ||
      change.ownership !== 'scaffold' ||
      change.expected.kind !== 'hash' ||
      change.expected.hash !== migration.expectedHash ||
      change.hash !== migration.resultHash ||
      previewSourceMigration(migration.id, change.content).status !==
        'already-applied'
    )
      throw new EngineError(
        'INVALID_PLAN',
        'migration',
        'Use matching finite copied-source migration metadata and exact postimages.',
      );
    migrationIds.add(migration.id);
  }
  const lockChange = plan.changes.find(
    (change) => change.path === 'vcli.lock.json',
  );
  if (plan.changes.length && !lockChange)
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Source changes require coordinated realized metadata.',
    );
  if (lockChange) {
    const lock = validateLock(parseJson(lockChange.content, 'plan'));
    if (
      lock.operationId !== plan.id ||
      canonical(lock.config) !== canonical(plan.config) ||
      canonical(lock.recipes) !== canonical(plan.recipes) ||
      lock.outcomes.source !== 'completed' ||
      canonical(lock.checks) !== canonical(plan.checks) ||
      canonical(lock.pending) !== canonical(plan.pending)
    )
      throw new EngineError(
        'INVALID_PLAN',
        'validation',
        'Plan metadata must match its operation and realized selections.',
      );
    for (const migrationId of migrationIds)
      if (!lock.migrations.includes(migrationId))
        throw new EngineError(
          'INVALID_PLAN',
          'migration',
          'Record every applied copied-source migration in realized metadata.',
        );
    for (const change of plan.changes) {
      if (['vcli.json', 'vcli.lock.json'].includes(change.path)) {
        if (change.ownership !== 'managed')
          throw new EngineError(
            'INVALID_PLAN',
            'validation',
            'State metadata must retain managed ownership.',
          );
        continue;
      }
      const metadata = lock.files[change.path];
      if (!metadata || metadata.ownership !== change.ownership)
        throw new EngineError(
          'INVALID_PLAN',
          'validation',
          'Every generated path must declare matching ownership.',
        );
      if (change.path === 'package.json')
        validatePackageFields(change.content, lock.packageFields);
      else if (metadata.ownership === 'managed') {
        const region = metadata.region ? managedRegion(change.content) : null;
        if (
          (metadata.region && !region) ||
          hash(region?.content ?? change.content) !== metadata.hash
        )
          throw new EngineError(
            'INVALID_PLAN',
            'validation',
            'Managed postimages must match their recorded content provenance.',
          );
      }
    }
  }
  const configChange = plan.changes.find(
    (change) => change.path === 'vcli.json',
  );
  if (
    configChange &&
    canonical(validateConfig(parseJson(configChange.content))) !==
      canonical(plan.config)
  )
    throw new EngineError(
      'INVALID_PLAN',
      'validation',
      'Desired metadata must match the plan.',
    );
  return plan;
}
export async function savePlan(
  input: GenerationPlan,
  file: string,
): Promise<void> {
  const plan = validatePlan(input);
  const absolute = path.resolve(file);
  await assertNoSymlinks(absolute);
  // An explicit saved plan is private and never silently replaces an existing file.
  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(json(plan));
    await handle.sync();
  } catch {
    throw new EngineError(
      'INVALID_PLAN',
      'save',
      'Choose an absent private plan path with an existing regular parent directory.',
    );
  } finally {
    await handle?.close();
  }
}
export async function readPlan(file: string): Promise<GenerationPlan> {
  const bytes = await readRegular(path.resolve(file));
  if (!bytes)
    throw new EngineError(
      'INVALID_PLAN',
      'read',
      'Select an existing saved plan.',
    );
  return validatePlan(parseJson(bytes.toString('utf8'), 'plan'));
}

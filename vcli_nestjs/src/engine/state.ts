import { z } from 'zod';
import path from 'node:path';
import {
  checkSchema,
  configSchema,
  hashSchema,
  idSchema,
  jsonValueSchema,
  outcomesSchema,
  parseJson,
  canonical,
  validateConfig,
  SUPPORTED_TOOL_VERSIONS,
  validateIdentifier,
} from './data.js';
import { EngineError } from './engine-error.js';
import { projectPath, readRegular, relativePath } from './paths.js';
import type { ProjectConfig } from '../contracts.js';
import type { ProjectLock, OperationJournal } from './types.js';
import { isManagedDocumentation } from './managed-content.js';
import { getSourceMigration } from './source-migrations.js';

export const recipeVersionSchema = z
  .object({
    id: z.string(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    family: z.string(),
  })
  .strict();
export const lockSchema = z
  .object({
    schemaVersion: z.literal(1),
    toolVersion: z.enum(SUPPORTED_TOOL_VERSIONS),
    config: configSchema,
    recipes: z.array(recipeVersionSchema),
    files: z.record(
      z.string(),
      z
        .object({
          ownership: z.enum(['managed', 'scaffold']),
          hash: hashSchema.optional(),
          region: z.boolean().optional(),
          provenance: z
            .object({
              renderer: z.string().regex(/^[a-z0-9.-]{1,64}$/),
              template: z
                .string()
                .regex(/^[a-z0-9./_-]{1,160}$/)
                .optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    packageFields: z.record(z.string(), jsonValueSchema),
    checks: z.array(checkSchema),
    pending: z.array(z.string()),
    outcomes: outcomesSchema,
    operationId: idSchema,
    migrations: z.array(z.string()),
  })
  .strict();
export function validateLock(value: unknown): ProjectLock {
  const result = lockSchema.safeParse(value);
  if (!result.success)
    throw new EngineError(
      'INVALID_STATE',
      'state',
      'Restore valid schema-1 realized metadata before continuing.',
    );
  const lock = result.data;
  validateConfig(lock.config);
  if (new Set(lock.migrations).size !== lock.migrations.length)
    throw new EngineError(
      'INVALID_STATE',
      'state',
      'Use unique recorded migration IDs.',
    );
  for (const id of lock.migrations) {
    validateIdentifier(id);
    if (id.startsWith('copied.')) getSourceMigration(id);
  }
  for (const [file, entry] of Object.entries(lock.files)) {
    relativePath(file);
    if (entry.region && !isManagedDocumentation(file))
      throw new EngineError(
        'INVALID_STATE',
        'state',
        'Legacy region provenance outside root README.md/AGENTS.md is unsafe; use a freshly generated private fixture or an explicitly reviewed migration, without adopting developer bytes.',
      );
    if (
      file === 'vcli.json' ||
      file === 'vcli.lock.json' ||
      file === 'package-lock.json' ||
      (entry.ownership === 'managed' &&
        !entry.hash &&
        file !== 'package.json') ||
      (entry.ownership === 'scaffold' && (entry.hash || entry.region))
    )
      throw new EngineError(
        'INVALID_STATE',
        'state',
        'Repair the bounded ownership metadata.',
      );
  }
  const families = new Set<string>();
  for (const recipe of lock.recipes) {
    if (
      families.has(recipe.family) ||
      lock.config.capabilities[recipe.family]?.recipe !== recipe.id
    )
      throw new EngineError(
        'INVALID_STATE',
        'state',
        'Restore matching realized recipe selections.',
      );
    families.add(recipe.family);
  }
  if (families.size !== Object.keys(lock.config.capabilities).length)
    throw new EngineError(
      'INVALID_STATE',
      'state',
      'Restore complete realized recipe selections.',
    );
  for (const field of Object.keys(lock.packageFields))
    if (
      !/^[A-Za-z0-9_@./~:-]+$/.test(field) ||
      field
        .split('/')
        .some((part) =>
          ['__proto__', 'constructor', 'prototype'].includes(part),
        )
    )
      throw new EngineError(
        'INVALID_STATE',
        'state',
        'Repair the bounded package metadata.',
      );
  return lock;
}
export async function readProject(projectDir: string): Promise<{
  projectDir: string;
  config: ProjectConfig;
  lock: ProjectLock;
  configBytes: Buffer;
  lockBytes: Buffer;
}> {
  const absolute = path.resolve(projectDir);
  const configBytes = await readRegular(
    await projectPath(absolute, 'vcli.json'),
  );
  const lockBytes = await readRegular(
    await projectPath(absolute, 'vcli.lock.json'),
  );
  if (!configBytes || !lockBytes)
    throw new EngineError(
      'INVALID_STATE',
      'state',
      'Use a VCLI project with both desired and realized metadata.',
    );
  const config = validateConfig(parseJson(configBytes.toString('utf8')));
  const lock = validateLock(parseJson(lockBytes.toString('utf8')));
  if (canonical(config) !== canonical(lock.config))
    throw new EngineError(
      'STATE_DRIFT',
      'state',
      'Reconcile desired selections with realized metadata; ordinary add cannot switch installed providers.',
    );
  return { projectDir: absolute, config, lock, configBytes, lockBytes };
}
export const journalSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    projectDir: z.string(),
    status: z.enum([
      'applying',
      'source-completed',
      'failed',
      'recovered',
      'conflicted',
    ]),
    outcomes: outcomesSchema,
    entries: z.array(
      z
        .object({
          path: z.string(),
          before: z.string().nullable(),
          afterHash: hashSchema,
          status: z.enum(['pending', 'written', 'restored']),
        })
        .strict(),
    ),
    createdDirectories: z.array(z.string()),
  })
  .strict();
export function validateJournal(
  input: unknown,
  projectDir: string,
): OperationJournal {
  const result = journalSchema.safeParse(input);
  if (!result.success || result.data.projectDir !== path.resolve(projectDir))
    throw new EngineError(
      'INVALID_STATE',
      'recovery',
      'Inspect the private operation journal and repair its supported schema.',
    );
  const paths = new Set<string>();
  for (const entry of result.data.entries) {
    relativePath(entry.path);
    if (
      paths.has(entry.path) ||
      (entry.before !== null &&
        (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          entry.before,
        ) ||
          entry.before.length > 24_000_000))
    )
      throw new EngineError(
        'INVALID_STATE',
        'recovery',
        'Repair duplicate paths or invalid journal preimages.',
      );
    paths.add(entry.path);
  }
  for (const directory of result.data.createdDirectories)
    relativePath(directory);
  return result.data;
}

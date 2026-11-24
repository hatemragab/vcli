import type { RenderedFile } from '../contracts.js';
import { hash } from './data.js';
import { EngineError } from './engine-error.js';
import { projectPath, readRegular } from './paths.js';
import {
  getSourceMigration,
  previewSourceMigration,
} from './source-migrations.js';
import type { readProject } from './state.js';
import type { GenerationPlan, ProjectLock } from './types.js';

export async function applySourceMigrationsToPlan(options: {
  projectDir: string;
  kind: GenerationPlan['kind'];
  previous?: Awaited<ReturnType<typeof readProject>>;
  sourceMigrations?: readonly string[];
  plan: GenerationPlan;
  lock: ProjectLock;
  recordChange: (
    file: Pick<RenderedFile, 'path' | 'ownership'>,
    content: string,
    before: Buffer,
  ) => Promise<void>;
}): Promise<void> {
  const { projectDir, kind, previous, sourceMigrations, plan, lock } = options;
  for (const migrationId of sourceMigrations ?? []) {
    if (kind !== 'upgrade' || !previous)
      throw new EngineError(
        'INVALID_PLAN',
        'migration',
        'Copied-source migrations require explicit upgrade planning.',
      );
    const definition = getSourceMigration(migrationId);
    if (previous.lock.files[definition.path]?.ownership !== 'scaffold')
      throw new EngineError(
        'MANAGED_CONFLICT',
        'migration',
        'Only an established copied scaffold can use this named migration.',
      );
    const before = await readRegular(
      await projectPath(projectDir, definition.path),
    );
    if (!before)
      throw new EngineError(
        'MANAGED_CONFLICT',
        'migration',
        'The copied source is missing; review the manual patch.',
      );
    const preview = previewSourceMigration(
      migrationId,
      before.toString('utf8'),
    );
    if (preview.status === 'manual' || preview.content === undefined)
      throw new EngineError(
        'MANAGED_CONFLICT',
        'migration',
        'Customized copied source requires the curated manual patch; no automatic rewrite is supported.',
      );
    if (preview.status === 'supported') {
      await options.recordChange(
        { path: definition.path, ownership: 'scaffold' },
        preview.content,
        before,
      );
      (plan.sourceMigrations ??= []).push({
        id: migrationId,
        path: definition.path,
        expectedHash: hash(before),
        resultHash: hash(preview.content),
      });
    }
    plan.guards.push({
      path: definition.path,
      expected: { kind: 'hash', hash: hash(before) },
    });
    if (!lock.migrations.includes(migrationId))
      lock.migrations.push(migrationId);
  }
}

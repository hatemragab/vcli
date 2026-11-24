import type {
  RecipeCatalog,
  RenderedFile,
  RenderedProject,
} from '../contracts.js';
import { canonical, TOOL_VERSION } from '../engine/data.js';
import { planUpgrade, summarizePlan } from '../engine/planning.js';
import { projectPath, readRegular } from '../engine/paths.js';
import { readProject } from '../engine/state.js';
import { resolveRecipes } from '../engine/resolve-recipes.js';
import {
  COPIED_MAIL_MIGRATION,
  COPIED_MAIL_PATH,
  STARTER_MIGRATIONS,
  getSourceMigration,
  previewSourceMigration,
} from '../engine/source-migrations.js';
import { inspectMaintenance, packageFacts } from './inventory.js';
import { assertSupportedBaseline } from './unsupported-baseline.js';
import { MaintenanceError } from './maintenance-error.js';
import { releaseMigration, supportedRelease } from './support-catalog.js';
import type {
  MaintenancePlan,
  MaintenanceSummary,
  MaintenanceUpgradeOptions,
} from './types.js';

function targetManifest(
  files: RenderedFile[],
  file: string,
  name: string,
  version: string,
): void {
  const rendered = files.find((entry) => entry.path === file);
  const facts = rendered ? packageFacts(rendered.content) : null;
  if (
    !facts ||
    facts.name !== name ||
    facts.version !== version ||
    rendered?.ownership !== 'managed'
  )
    throw new MaintenanceError(
      'TARGET_ASSET_MISMATCH',
      'Build the exact target private distribution and its matching vendored package assets before planning the upgrade.',
    );
  if (name === '@vcli/auth-runtime') {
    const exports =
      facts.exports && typeof facts.exports === 'object'
        ? (facts.exports as Record<string, unknown>)
        : {};
    if (
      !['.', './errors', './opaque', './password', './jwt'].every(
        (entry) => exports[entry],
      )
    )
      throw new MaintenanceError(
        'TARGET_ASSET_MISMATCH',
        'Retain all compatible authentication package subpath exports.',
      );
  }
}
export async function planMaintenanceUpgrade(
  options: MaintenanceUpgradeOptions,
): Promise<MaintenancePlan> {
  const targetVersion = supportedRelease(options.targetVersion);
  if (targetVersion !== TOOL_VERSION)
    throw new MaintenanceError(
      'UNSUPPORTED_RELEASE',
      'Run the exact reviewed target CLI to plan its coordinated private upgrade.',
    );
  const state = await readProject(options.projectDir);
  releaseMigration(state.lock.toolVersion, targetVersion);
  const baselineGuards = await assertSupportedBaseline(
    state.projectDir,
    state.lock,
  );
  const inventory = await inspectMaintenance(state.projectDir);
  const resolved = resolveRecipes(state.config, options.catalog);
  if (canonical(resolved.config) !== canonical(state.config))
    throw new MaintenanceError(
      'MAINTENANCE_STATE_INVALID',
      'Retain the installed provider options through this compatible patch release.',
    );
  const upgrades = state.lock.recipes.flatMap((recipe) => {
    const next = resolved.recipes.find(
      (entry) => entry.id === recipe.id && entry.family === recipe.family,
    );
    if (!next || next.version !== targetVersion)
      throw new MaintenanceError(
        'TARGET_ASSET_MISMATCH',
        'Use the exact target coordinated recipe catalog; provider changes are excluded.',
      );
    const migration = releaseMigration(recipe.version, next.version);
    if (!migration) return [];
    return [
      {
        recipe: recipe.id,
        from: recipe.version,
        to: next.version,
        migrationId: `recipe.${recipe.family}.${migration}`,
      },
    ];
  });
  const rendered: RenderedProject = await options.catalog.render(
    resolved.config,
    resolved.recipes,
  );
  targetManifest(
    rendered.files,
    'tools/vcli/package.json',
    '@vcli/cli',
    targetVersion,
  );
  if (state.config.capabilities.auth)
    targetManifest(
      rendered.files,
      'tools/vcli-auth-runtime/package.json',
      '@vcli/auth-runtime',
      targetVersion,
    );
  const codemods: MaintenancePlan['codemods'] = [];
  const manual: MaintenancePlan['manual'] = [];
  const sourceMigrations: string[] = [];
  for (const [id, starter] of Object.entries(STARTER_MIGRATIONS)) {
    if (state.lock.files[starter.path]?.ownership !== 'scaffold') continue;
    const bytes = await readRegular(
      await projectPath(state.projectDir, starter.path),
    );
    const preview = bytes
      ? previewSourceMigration(id, bytes.toString('utf8'))
      : { status: 'manual' as const };
    if (preview.status === 'supported') {
      sourceMigrations.push(id);
      codemods.push({ id, path: starter.path, status: 'planned' });
    } else if (preview.status === 'manual') {
      rendered.pending.push(starter.instruction);
    }
  }
  if (state.lock.files[COPIED_MAIL_PATH]) {
    const definition = getSourceMigration(COPIED_MAIL_MIGRATION);
    const bytes = await readRegular(
      await projectPath(state.projectDir, definition.path),
    );
    const preview = bytes
      ? previewSourceMigration(definition.id, bytes.toString('utf8'))
      : { status: 'manual' as const };
    if (preview.status === 'manual') {
      const patchPath = 'docs/vcli/patches/mail-subject-controls-v1.patch';
      manual.push({
        id: definition.id,
        path: definition.path,
        patchPath,
        status: 'review-required',
      });
      if (!state.lock.files[patchPath])
        rendered.files.push({
          path: patchPath,
          content: definition.patch,
          ownership: 'scaffold',
        });
      rendered.pending.push(
        `Manual copied-source review required: ${definition.path}; curated demonstration patch: ${patchPath}.`,
      );
    } else {
      sourceMigrations.push(definition.id);
      codemods.push({
        id: definition.id,
        path: definition.path,
        status: preview.status === 'supported' ? 'planned' : 'already-applied',
      });
    }
    const targetSource = rendered.files.find(
      (entry) => entry.path === COPIED_MAIL_PATH,
    );
    if (
      !targetSource ||
      previewSourceMigration(definition.id, targetSource.content).status !==
        'already-applied'
    )
      throw new MaintenanceError(
        'TARGET_ASSET_MISMATCH',
        'Activate the patched copied-source target asset before claiming this target release.',
      );
  }
  const targetCatalog: RecipeCatalog = {
    recipes: options.catalog.recipes,
    render: async () => structuredClone(rendered),
  };
  const plan = await planUpgrade({
    projectDir: state.projectDir,
    catalog: targetCatalog,
    upgrades,
    sourceMigrations,
  });
  for (const guard of baselineGuards)
    plan.guards.push({
      path: guard.path,
      expected: { kind: 'hash', hash: guard.hash },
    });
  // Sensitive unknown runtime assets are not silently classified as fixed by a manifest bump.
  if (
    inventory.components.some(
      (component) =>
        component.kind === 'runtime-library' && component.version === 'unknown',
    )
  )
    throw new MaintenanceError(
      'MAINTENANCE_STATE_INVALID',
      'Restore known managed runtime package provenance before a compatible package upgrade.',
    );
  const dependencies: MaintenancePlan['dependencies'] = inventory.components
    .filter((component) => component.kind === 'runtime-library')
    .map((component) => ({
      name: component.id === 'cli' ? '@vcli/cli' : '@vcli/auth-runtime',
      from: component.version,
      to: targetVersion,
      status:
        component.version === targetVersion ? 'unchanged' : 'pending-install',
    }));
  return {
    plan,
    targetVersion,
    components: inventory.components,
    codemods,
    manual,
    dependencies,
  };
}
export function summarizeMaintenancePlan(
  result: MaintenancePlan,
): MaintenanceSummary {
  return {
    generation: summarizePlan(result.plan),
    targetVersion: result.targetVersion,
    components: structuredClone(result.components),
    codemods: structuredClone(result.codemods),
    manual: structuredClone(result.manual),
    dependencies: structuredClone(result.dependencies),
    claims: 'source-plan-only',
  };
}

import path from 'node:path';
import { canonical, hash, parseJson } from '../engine/data.js';
import { installationHealthy } from '../engine/inspection.js';
import { readProject } from '../engine/state.js';
import { projectPath, readRegular } from '../engine/paths.js';
import {
  COPIED_MAIL_MIGRATION,
  COPIED_MAIL_PATH,
  previewSourceMigration,
} from '../engine/source-migrations.js';
import { PATCH_OWNER, supportedRelease } from './support-catalog.js';
import type { MaintenanceComponent, MaintenanceInventory } from './types.js';

export function packageFacts(content: string): {
  name: string;
  version: string;
  exports?: unknown;
  peerDependencies?: unknown;
  peerDependenciesMeta?: unknown;
} | null {
  const input: unknown = parseJson(content, 'maintenance');
  if (
    !input ||
    typeof input !== 'object' ||
    !('name' in input) ||
    !('version' in input) ||
    typeof input.name !== 'string' ||
    typeof input.version !== 'string'
  )
    return null;
  return {
    name: input.name,
    version: input.version,
    ...('exports' in input ? { exports: input.exports } : {}),
    ...('peerDependencies' in input
      ? { peerDependencies: input.peerDependencies }
      : {}),
    ...('peerDependenciesMeta' in input
      ? { peerDependenciesMeta: input.peerDependenciesMeta }
      : {}),
  };
}
export async function inspectMaintenance(
  projectDir: string,
): Promise<MaintenanceInventory> {
  const state = await readProject(projectDir);
  const components: MaintenanceComponent[] = [];
  const installation =
    state.lock.outcomes.install === 'completed' &&
    (await installationHealthy(state.projectDir))
      ? ('completed' as const)
      : state.lock.outcomes.install === 'completed'
        ? ('failed' as const)
        : state.lock.outcomes.install;
  const warnings = [
    'Only curated components are inventoried; arbitrary custom code, private environments and deployed artifacts are outside this report.',
  ];
  for (const [id, manifestPath] of [
    ['cli', 'tools/vcli/package.json'],
    ...(state.config.capabilities.auth
      ? [['auth-runtime', 'tools/vcli-auth-runtime/package.json']]
      : []),
  ] as const) {
    const bytes = await readRegular(
      await projectPath(state.projectDir, manifestPath),
    );
    const owned = state.lock.files[manifestPath];
    let known = false;
    let version: MaintenanceComponent['version'] = 'unknown';
    if (bytes && owned?.ownership === 'managed' && owned.hash === hash(bytes)) {
      const facts = packageFacts(bytes.toString('utf8'));
      if (facts?.name === (id === 'cli' ? '@vcli/cli' : '@vcli/auth-runtime')) {
        try {
          version = supportedRelease(facts.version);
          known = true;
        } catch {
          /* Unknown versions remain explicit. */
        }
      }
    }
    if (known && id === 'auth-runtime') {
      for (const [asset, metadata] of Object.entries(state.lock.files)) {
        if (
          !asset.startsWith('tools/vcli-auth-runtime/') ||
          asset === manifestPath
        )
          continue;
        const source = await readRegular(
          await projectPath(state.projectDir, asset),
        );
        if (
          metadata.ownership !== 'managed' ||
          !source ||
          metadata.hash !== hash(source)
        ) {
          known = false;
          version = 'unknown';
          break;
        }
      }
    }
    let installedVersion: MaintenanceComponent['version'] = 'unknown';
    const packageName = id === 'cli' ? '@vcli/cli' : '@vcli/auth-runtime';
    const installed = await readRegular(
      path.join(state.projectDir, 'node_modules', packageName, 'package.json'),
    );
    if (installed) {
      const facts = packageFacts(installed.toString('utf8'));
      if (facts?.name === packageName) {
        try {
          installedVersion = supportedRelease(facts.version);
        } catch {
          /* Unknown installed package remains unknown. */
        }
      }
    }
    let componentInstallation = installation;
    if (id === 'auth-runtime' && componentInstallation === 'completed') {
      for (const [asset, metadata] of Object.entries(state.lock.files)) {
        if (!asset.startsWith('tools/vcli-auth-runtime/dist/')) continue;
        const relative = asset.slice('tools/vcli-auth-runtime/'.length);
        const installedBytes = await readRegular(
          path.join(state.projectDir, 'node_modules', packageName, relative),
        );
        if (!installedBytes || hash(installedBytes) !== metadata.hash) {
          installedVersion = 'unknown';
          componentInstallation = 'failed';
          break;
        }
      }
    }
    components.push({
      id: id as 'cli' | 'auth-runtime',
      kind: 'runtime-library',
      version,
      provenance: known ? 'managed-package-manifest' : 'customized-or-unknown',
      paths: [manifestPath],
      installedVersion,
      installation: componentInstallation,
      patchOwner: PATCH_OWNER,
    });
  }
  if (state.lock.files[COPIED_MAIL_PATH]) {
    const bytes = await readRegular(
      await projectPath(state.projectDir, COPIED_MAIL_PATH),
    );
    const result = bytes
      ? previewSourceMigration(COPIED_MAIL_MIGRATION, bytes.toString('utf8'))
          .status
      : 'manual';
    components.push({
      id: 'copied-mail-rendering',
      kind: 'copied-source',
      version:
        result === 'supported'
          ? '0.1.0'
          : result === 'already-applied'
            ? '0.1.1'
            : 'unknown',
      provenance:
        result === 'manual'
          ? 'customized-or-unknown'
          : 'recognized-copied-function',
      paths: [COPIED_MAIL_PATH],
      patchOwner: PATCH_OWNER,
    });
  }
  if (canonical(state.config) !== canonical(state.lock.config))
    warnings.push('Desired and realized state differ.');
  return {
    schemaVersion: 1,
    project: state.config.project.name,
    release: state.lock.toolVersion,
    scope: 'curated-components-only',
    components,
    warnings,
  };
}

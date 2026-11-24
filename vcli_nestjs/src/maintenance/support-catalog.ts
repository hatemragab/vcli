import { NODE_ENGINE_RANGE, SUPPORTED_TOOL_VERSIONS } from '../contracts.js';
import type { SupportedRelease, SupportCatalog } from './types.js';
import { MaintenanceError } from './maintenance-error.js';
export const PATCH_OWNER = 'Hatem — private release and remediation owner';
export function supportedRelease(value: string): SupportedRelease {
  const release = SUPPORTED_TOOL_VERSIONS.find((version) => version === value);
  if (!release)
    throw new MaintenanceError(
      'UNSUPPORTED_RELEASE',
      'Use an exact curated private release; no version ranges, latest or inferred release gaps.',
    );
  return release;
}
export function getSupportCatalog(): SupportCatalog {
  return {
    schemaVersion: 1,
    distribution: 'private-unpublished',
    releases: SUPPORTED_TOOL_VERSIONS.map((version) => ({
      version: supportedRelease(version),
      schemaVersion: 1,
      authRuntime: supportedRelease(version),
      node: NODE_ENGINE_RANGE,
      patchOwner: PATCH_OWNER,
    })),
    edges: [
      {
        from: '0.1.0',
        to: '0.1.1',
        migration: 'private-patch-0-1-1',
        baselineProfiles: ['curated-capture-immediate-v1'],
      },
      {
        from: '0.1.0',
        to: '0.1.2',
        migration: 'private-patch-0-1-2',
        baselineProfiles: ['curated-capture-immediate-v1'],
      },
      {
        from: '0.1.1',
        to: '0.1.2',
        migration: 'private-patch-0-1-2',
        baselineProfiles: ['matching-managed-project'],
      },
    ],
  };
}
export function releaseMigration(from: string, to: string): string | undefined {
  supportedRelease(from);
  supportedRelease(to);
  if (from === to) return undefined;
  const edge = getSupportCatalog().edges.find(
    (entry) => entry.from === from && entry.to === to,
  );
  if (!edge)
    throw new MaintenanceError(
      'UNSUPPORTED_MIGRATION',
      'No curated migration connects these exact private releases; downgrade and provider conversion are unsupported.',
    );
  return edge.migration;
}

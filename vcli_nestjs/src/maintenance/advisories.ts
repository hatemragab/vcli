import { COPIED_MAIL_MIGRATION } from '../engine/source-migrations.js';
import type { AdvisoryFinding, MaintenanceInventory } from './types.js';

/** Demonstration data only: these identifiers are fixture advisories, never real CVEs. */
export function reportAdvisories(
  inventory: MaintenanceInventory,
): AdvisoryFinding[] {
  return inventory.components
    .filter((component) => component.id !== 'cli')
    .map((component) => {
      const copied = component.kind === 'copied-source';
      return {
        id: copied
          ? 'VCLI-FIXTURE-COPIED-SUBJECT-001'
          : 'VCLI-FIXTURE-AUTH-PACKAGE-001',
        fixture: true,
        component: component.id,
        status:
          component.version === 'unknown'
            ? 'unknown'
            : component.version === '0.1.0'
              ? 'affected'
              : !copied &&
                  (component.installation !== 'completed' ||
                    component.installedVersion !== component.version)
                ? 'source-fixed-install-pending'
                : 'fixed',
        affectedVersions: ['0.1.0'],
        fixedVersion: '0.1.1',
        paths: [...component.paths],
        remediation: copied
          ? 'named-source-migration-or-manual-review'
          : 'compatible-package-update',
        ...(copied ? { migrationId: COPIED_MAIL_MIGRATION } : {}),
        patchOwner: component.patchOwner,
        action:
          component.version === 'unknown'
            ? 'Review customized or unrecognized source manually; this inventory cannot establish remediation.'
            : copied
              ? 'Apply the exact supported copied-source patch or review its curated manual diff; a package bump does not remediate this copy.'
              : 'Upgrade the vendored auth package through the curated compatible edge, explicitly install dependencies and re-run affected contracts; deployed remediation remains separate.',
      };
    });
}

import type { RecipeCatalog, SUPPORTED_TOOL_VERSIONS } from '../contracts.js';
import type { GenerationPlan, PlanSummary } from '../engine/types.js';
export type SupportedRelease = (typeof SUPPORTED_TOOL_VERSIONS)[number];
export interface SupportCatalog {
    schemaVersion: 1;
    distribution: 'private-unpublished';
    releases: {
        version: SupportedRelease;
        schemaVersion: 1;
        authRuntime: SupportedRelease;
        node: string;
        patchOwner: string;
    }[];
    edges: {
        from: SupportedRelease;
        to: SupportedRelease;
        migration: string;
        baselineProfiles: string[];
    }[];
}
export interface MaintenanceComponent {
    id: 'cli' | 'auth-runtime' | 'copied-mail-rendering';
    kind: 'runtime-library' | 'copied-source';
    version: SupportedRelease | 'unknown';
    provenance: 'managed-package-manifest' | 'recognized-copied-function' | 'customized-or-unknown';
    paths: string[];
    patchOwner: string;
    installedVersion?: SupportedRelease | 'unknown';
    installation?: 'pending' | 'completed' | 'failed';
}
export interface MaintenanceInventory {
    schemaVersion: 1;
    project: string;
    release: string;
    scope: 'curated-components-only';
    components: MaintenanceComponent[];
    warnings: string[];
}
export interface AdvisoryFinding {
    id: string;
    fixture: true;
    component: MaintenanceComponent['id'];
    status: 'affected' | 'fixed' | 'source-fixed-install-pending' | 'unknown';
    affectedVersions: SupportedRelease[];
    fixedVersion: SupportedRelease;
    paths: string[];
    remediation: 'compatible-package-update' | 'named-source-migration-or-manual-review';
    migrationId?: string;
    patchOwner: string;
    action: string;
}
export interface MaintenanceUpgradeOptions {
    projectDir: string;
    targetVersion: string;
    catalog: RecipeCatalog;
}
export interface MaintenancePlan {
    plan: GenerationPlan;
    targetVersion: SupportedRelease;
    components: MaintenanceComponent[];
    codemods: {
        id: string;
        path: string;
        status: 'planned' | 'already-applied';
    }[];
    manual: {
        id: string;
        path: string;
        patchPath: string;
        status: 'review-required';
    }[];
    dependencies: {
        name: string;
        from: string;
        to: string;
        status: 'pending-install' | 'unchanged';
    }[];
}
export interface MaintenanceSummary {
    generation: PlanSummary;
    targetVersion: SupportedRelease;
    components: MaintenanceComponent[];
    codemods: MaintenancePlan['codemods'];
    manual: MaintenancePlan['manual'];
    dependencies: MaintenancePlan['dependencies'];
    claims: 'source-plan-only';
}

import type { MaintenanceInventory } from './types.js';
export declare function packageFacts(content: string): {
    name: string;
    version: string;
    exports?: unknown;
    peerDependencies?: unknown;
    peerDependenciesMeta?: unknown;
} | null;
export declare function inspectMaintenance(projectDir: string): Promise<MaintenanceInventory>;

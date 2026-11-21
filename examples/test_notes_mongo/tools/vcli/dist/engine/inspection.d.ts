import { readProject } from './state.js';
import type { Inspection, ManagedFile } from './types.js';
export declare function localFileDependencyHealthy(projectDir: string, name: string, directory: string, managed: Record<string, ManagedFile>): Promise<boolean>;
/** Local evidence only: both npm locks plus every recorded installed manifest must match installed versions. */
export declare function installationHealthy(projectDir: string, managedHashes?: ReadonlyMap<string, string>): Promise<boolean>;
/** Hash and install guards still run. A preloaded snapshot skips only the second metadata read. */
export declare function inspectProject(projectDir: string, preloaded?: Awaited<ReturnType<typeof readProject>>): Promise<Inspection>;
export declare function doctorProject(projectDir: string): Promise<Inspection>;

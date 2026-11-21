import { writeLastResult } from './last-result.js';
import { readProject } from './state.js';
import type { CommandRunner, PackageFields, ProjectLock } from './types.js';
export declare function scriptName(args: readonly string[]): string;
export declare function remember(projectDir: string, result: Parameters<typeof writeLastResult>[1]): Promise<void>;
/** No shell, output collection, or forwarding of potentially secret subprocess text. */
export declare const spawnCommand: CommandRunner;
export declare function updateState(projectDir: string, lock: ProjectLock, previousHash: string): Promise<void>;
export declare function checkManagedManifest(projectDir: string, fields: PackageFields): Promise<void>;
export declare function executableState(projectDir: string): Promise<Awaited<ReturnType<typeof readProject>>>;

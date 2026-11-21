import { lstat } from 'node:fs/promises';
import type { ExpectedFile } from './types.js';
export declare function relativePath(value: string, internal?: boolean): string;
export declare function contained(root: string, candidate: string): void;
export declare function statOrNull(file: string): Promise<Awaited<ReturnType<typeof lstat>> | null>;
export declare function isErrno(error: unknown, code: string): boolean;
/** Check every existing ancestor, including the target, before any content access. */
export declare function assertNoSymlinks(file: string): Promise<void>;
export declare function projectPath(projectDir: string, relative: string, internal?: boolean): Promise<string>;
export declare function readRegular(file: string): Promise<Buffer | null>;
export declare function expectedFile(file: string): Promise<ExpectedFile>;
export declare function checkExpected(file: string, expected: ExpectedFile): Promise<void>;
export declare function resolveDestination(workspaceDir: string, projectDir: string): Promise<{
    workspaceDir: string;
    projectDir: string;
}>;
export declare function initEntries(projectDir: string): Promise<string[]>;

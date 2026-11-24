import type { TargetProfile } from './types.js';
export declare function validatePrivateAncestors(path: string): Promise<void>;
export declare function readPrivateJson(path: string): Promise<unknown>;
export declare function loadTargetProfile(path: string): Promise<TargetProfile>;
export declare function ensureJournalDirectory(path: string): Promise<void>;
export declare function readOptional(path: string): Promise<unknown | undefined>;
export declare function writePrivateJson(path: string, value: unknown): Promise<void>;
export declare function acquireLock(path: string, planId: string): Promise<string>;
export declare function releaseLock(path: string, id: string): Promise<void>;

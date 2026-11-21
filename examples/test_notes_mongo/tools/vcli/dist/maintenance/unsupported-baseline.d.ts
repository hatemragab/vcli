import type { ProjectLock } from '../engine/types.js';
/** Finite reviewed runtime contract; this is not admission by version label alone. */
export declare const CURATED_CAPTURE_PROFILE = "curated-capture-immediate-v1";
export declare function assertSupportedBaseline(projectDir: string, lock: ProjectLock): Promise<{
    path: string;
    hash: string;
}[]>;

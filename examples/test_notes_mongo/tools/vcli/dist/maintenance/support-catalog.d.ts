import type { SupportedRelease, SupportCatalog } from './types.js';
export declare const PATCH_OWNER = "Hatem \u2014 private release and remediation owner";
export declare function supportedRelease(value: string): SupportedRelease;
export declare function getSupportCatalog(): SupportCatalog;
export declare function releaseMigration(from: string, to: string): string | undefined;

import type { RecoveryOptions, RecoveryResult } from './types.js';
/** Rollback is byte-conditional and cannot undo npm scripts or external effects. */
export declare function recoverOperation(projectDir: string, options?: RecoveryOptions): Promise<RecoveryResult>;

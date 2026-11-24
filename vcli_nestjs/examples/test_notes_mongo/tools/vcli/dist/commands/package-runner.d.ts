import type { CommandRunner } from '../engine/types.js';
/** Keep raw child text private. Only parsed diagnostics leave this runner. */
export declare function packageRunner(offline: boolean): CommandRunner;

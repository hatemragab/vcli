import type { ProjectConfig, RenderedFile } from '../contracts.js';
/** Transport source and configured exports; no database source for immediate mail. */
export declare function mailFiles(config: ProjectConfig): Promise<RenderedFile[]>;
/** Independent from transport selection: Firebase provider mode does not require mail. */
export declare function firebaseMailFiles(config: ProjectConfig): Promise<RenderedFile[]>;

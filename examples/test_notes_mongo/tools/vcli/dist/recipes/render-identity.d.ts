import type { ProjectConfig, RenderedFile } from '../contracts.js';
/** Selected identity source plus explicit owner composition; no root/schema composition. */
export declare function identityFiles(config: ProjectConfig): Promise<RenderedFile[]>;

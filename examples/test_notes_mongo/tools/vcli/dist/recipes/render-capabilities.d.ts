import type { ProjectConfig, RenderedFile } from '../contracts.js';
export { mailFiles } from './render-mail.js';
export declare function storageFiles(config: ProjectConfig): Promise<RenderedFile[]>;
export declare function mediaFiles(config: ProjectConfig): Promise<RenderedFile[]>;
export { pushFiles } from './render-push.js';

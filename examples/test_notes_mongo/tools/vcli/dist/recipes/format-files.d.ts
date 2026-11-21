import type { RenderedFile } from '../contracts.js';
export declare function formatYaml(content: string): Promise<string>;
/** Format returned bytes in memory; never walk or mutate the user's project. */
export declare function formatFiles(files: RenderedFile[]): Promise<RenderedFile[]>;

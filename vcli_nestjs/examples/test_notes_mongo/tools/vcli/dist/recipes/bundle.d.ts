import type { RenderedFile } from '../contracts.js';
/** All asset paths are code-owned; callers cannot select arbitrary filesystem input. */
export declare function bundled(path: string, variant?: string): Promise<RenderedFile>;
export declare const file: (path: string, content: string, ownership?: RenderedFile["ownership"]) => RenderedFile;
export declare const json: (value: unknown) => string;
export declare function runtime(path: string, variant: string): Promise<RenderedFile>;

import { type RenderedFile } from '../contracts.js';
import { EngineError } from './engine-error.js';
import type { ManagedFile } from './types.js';
/** Turn a recipe failure into a public engine error. Raw exception text stays out. */
export declare function renderError(error: unknown): EngineError;
/** Attach provenance only when the lock entry is being rewritten. */
export declare function recordedFile(file: RenderedFile, entry: ManagedFile): ManagedFile;

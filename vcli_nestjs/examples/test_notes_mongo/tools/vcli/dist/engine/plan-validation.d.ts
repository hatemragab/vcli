import type { CheckCommand, ProjectConfig, RecipeCatalog, RenderedFile, RenderedProject } from '../contracts.js';
import type { ProjectLock } from './types.js';
export declare function validatedChecks(checks: CheckCommand[]): CheckCommand[];
export declare function validateFiles(files: RenderedFile[]): void;
export declare function renderCatalog(config: ProjectConfig, catalog: RecipeCatalog): Promise<{
    config: ProjectConfig;
    recipes: ProjectLock['recipes'];
    rendered: RenderedProject;
}>;
export declare function activeGuard(projectDir: string): Promise<void>;

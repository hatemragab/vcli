import type { ProjectConfig, Recipe, RenderedProject } from '../contracts.js';
export declare function renderProject(config: ProjectConfig, resolved: readonly Recipe[]): Promise<RenderedProject>;

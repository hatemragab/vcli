import type { ProjectConfig, Recipe, RecipeCatalog } from '../contracts.js';
/** Resolves family requirements without picking a provider or executing a renderer. */
export declare function resolveRecipes(input: ProjectConfig, catalog: RecipeCatalog): {
    config: ProjectConfig;
    recipes: Recipe[];
};

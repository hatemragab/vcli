import type { ProjectConfig, Recipe, RecipeCatalog } from '../contracts.js';
import {
  canonical,
  rejectPrivateValues,
  validateConfig,
  validateIdentifier,
} from './data.js';
import { describeThrown } from '../contracts.js';
import { EngineError, toEngineError } from './engine-error.js';

/** Resolves family requirements without picking a provider or executing a renderer. */
export function resolveRecipes(
  input: ProjectConfig,
  catalog: RecipeCatalog,
): { config: ProjectConfig; recipes: Recipe[] } {
  const config = validateConfig(input);
  const registry = new Map<string, Recipe>();
  for (const recipe of catalog.recipes) {
    validateIdentifier(recipe.id);
    validateIdentifier(recipe.family);
    if (
      registry.has(recipe.id) ||
      !/^\d+\.\d+\.\d+$/.test(recipe.version) ||
      typeof recipe.validateOptions !== 'function'
    )
      throw new EngineError(
        'INVALID_CATALOG',
        'resolve',
        'Use unique versioned curated recipe IDs.',
      );
    for (const family of recipe.requires) validateIdentifier(family);
    for (const id of recipe.conflicts) validateIdentifier(id);
    registry.set(recipe.id, recipe);
  }
  if (!config.capabilities.foundation)
    throw new EngineError(
      'MISSING_CAPABILITY',
      'resolve',
      'Select the foundation capability explicitly.',
    );
  const selected = new Map<string, Recipe>();
  for (const [family, selection] of Object.entries(config.capabilities).sort(
    ([a], [b]) => a.localeCompare(b, 'en'),
  )) {
    const recipe = registry.get(selection.recipe);
    if (!recipe)
      throw new EngineError(
        'UNKNOWN_RECIPE',
        'resolve',
        'Select a recipe present in this bundled catalog.',
      );
    if (
      recipe.family !== family ||
      [...selected.values()].some((item) => item.id === recipe.id)
    )
      throw new EngineError(
        'RECIPE_CONFLICT',
        'resolve',
        'Each family must contain exactly one matching recipe.',
      );
    let options;
    try {
      options = recipe.validateOptions(selection.options);
    } catch (error) {
      const described = describeThrown(error);
      if (described) throw toEngineError(described);
      throw new EngineError(
        'INVALID_OPTIONS',
        'resolve',
        'Use only the documented options for the selected recipe.',
      );
    }
    rejectPrivateValues(options);
    config.capabilities[family] = { recipe: recipe.id, options };
    selected.set(family, recipe);
  }
  const ids = new Set([...selected.values()].map((recipe) => recipe.id));
  for (const recipe of selected.values()) {
    if (recipe.requires.some((family) => !selected.has(family)))
      throw new EngineError(
        'MISSING_CAPABILITY',
        'resolve',
        'Explicitly select every required family before generating.',
      );
    if (recipe.conflicts.some((id) => ids.has(id)))
      throw new EngineError(
        'RECIPE_CONFLICT',
        'resolve',
        'Remove the conflicting selection or choose a compatible recipe.',
      );
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: Recipe[] = [];
  function visit(family: string): void {
    if (visiting.has(family))
      throw new EngineError(
        'RECIPE_CYCLE',
        'resolve',
        'Correct the curated capability dependency cycle.',
      );
    if (visited.has(family)) return;
    const recipe = selected.get(family);
    if (!recipe)
      throw new EngineError(
        'MISSING_CAPABILITY',
        'resolve',
        'Explicitly select the missing capability.',
      );
    visiting.add(family);
    for (const requirement of [...recipe.requires].sort()) visit(requirement);
    visiting.delete(family);
    visited.add(family);
    ordered.push(recipe);
  }
  for (const family of [...selected.keys()].sort()) visit(family);
  // Validate normalized validator output as well as the untrusted input.
  return {
    config: validateConfig(JSON.parse(canonical(config))),
    recipes: ordered,
  };
}

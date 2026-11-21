import { checkSchema } from './data.js';
import { EngineError } from './engine-error.js';
import { listJournals, unfinishedJournals } from './operation-storage.js';
import { relativePath } from './paths.js';
import { renderError } from './plan-assembly.js';
import { resolveRecipes } from './resolve-recipes.js';
export function validatedChecks(checks) {
    if (!Array.isArray(checks) ||
        checks.some((check) => !checkSchema.safeParse(check).success))
        throw new EngineError('INVALID_CATALOG', 'planning', 'Declare checks as named npm run script argument vectors.');
    if (new Set(checks.map((check) => check.name)).size !== checks.length)
        throw new EngineError('INVALID_CATALOG', 'planning', 'Give every check a unique stable name.');
    return checks;
}
export function validateFiles(files) {
    const paths = new Set();
    for (const file of files) {
        relativePath(file.path);
        if (['vcli.json', 'vcli.lock.json', 'package-lock.json'].includes(file.path) ||
            paths.has(file.path) ||
            typeof file.content !== 'string' ||
            Buffer.byteLength(file.content) > 16_000_000 ||
            !['managed', 'scaffold'].includes(file.ownership))
            throw new EngineError('INVALID_CATALOG', 'planning', 'Render unique bounded files and leave state and package-manager locks to their owners.');
        paths.add(file.path);
    }
    for (const file of paths)
        if ([...paths].some((other) => other !== file && other.startsWith(`${file}/`)))
            throw new EngineError('INVALID_CATALOG', 'planning', 'A generated file cannot also be a directory ancestor.');
}
export async function renderCatalog(config, catalog) {
    const resolved = resolveRecipes(config, catalog);
    let rendered;
    try {
        rendered = await catalog.render(resolved.config, resolved.recipes);
    }
    catch (error) {
        throw renderError(error);
    }
    validateFiles(rendered.files);
    validatedChecks(rendered.checks);
    return {
        config: resolved.config,
        recipes: resolved.recipes.map(({ id, family, version }) => ({
            id,
            family,
            version,
        })),
        rendered,
    };
}
export async function activeGuard(projectDir) {
    if (unfinishedJournals(await listJournals(projectDir)).length)
        throw new EngineError('INCOMPLETE_OPERATION', 'planning', 'Recover the interrupted source operation before planning another mutation.');
}
//# sourceMappingURL=plan-validation.js.map
import { CliError } from './cli-error.js';
export function parseOptions(value) {
    if (value === undefined)
        return {};
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error();
        return parsed;
    }
    catch {
        throw new CliError('INVALID_OPTIONS', 'Supply a JSON object containing nonsecret recipe choices.');
    }
}
export function selectRecipes(catalog, options, mainRecipe) {
    const selected = {};
    const add = (id, settings = {}) => {
        const recipe = catalog.recipes.find((recipe) => recipe.id === id);
        if (!recipe)
            throw new CliError('UNKNOWN_RECIPE', 'Run catalog to see supported recipe identifiers.');
        const existing = selected[recipe.family];
        if (existing && existing.recipe !== recipe.id)
            throw new CliError('RECIPE_CONFLICT', 'Choose one recipe per exclusive family.');
        selected[recipe.family] = {
            recipe: recipe.id,
            options: recipe.validateOptions({ ...existing?.options, ...settings }),
        };
    };
    if (mainRecipe)
        add(mainRecipe, parseOptions(options.options));
    else if (options.options !== undefined)
        throw new CliError('INVALID_OPTIONS', 'Use --options with a named recipe in add.');
    for (const id of options.with ?? [])
        add(id);
    for (const [family, value] of [
        ['database', options.database],
        ['auth', options.auth],
        ['mail', options.mail],
        ['storage', options.storage],
        ['realtime', options.realtime],
        ['deployment', options.deploy],
    ]) {
        if (!value)
            continue;
        const id = `${family}.${value}`;
        add(id);
    }
    if (options.firebaseMethods || options.actionDelivery) {
        if (selected.auth?.recipe !== 'auth.firebase')
            throw new CliError('INVALID_OPTIONS', 'Select auth.firebase before supplying its method/action options.');
        const settings = {};
        if (options.firebaseMethods)
            settings.methods = options.firebaseMethods.split(',');
        if (options.actionDelivery)
            settings.actionDelivery = options.actionDelivery;
        add('auth.firebase', settings);
    }
    if (options.localIdentifier !== undefined) {
        if (selected.auth?.recipe !== 'auth.local')
            throw new CliError('INVALID_OPTIONS', 'Select auth.local before supplying --local-identifier.');
        add('auth.local', { identifier: options.localIdentifier });
    }
    if (options.realtimeScale) {
        if (!selected.realtime)
            throw new CliError('INVALID_OPTIONS', 'Select a realtime provider before --realtime-scale.');
        add(selected.realtime.recipe, { scale: options.realtimeScale });
    }
    if (options.reliableActions !== undefined) {
        if (!selected.mail)
            throw new CliError('INVALID_OPTIONS', 'Select a mail provider before --reliable-actions.');
        add(selected.mail.recipe, { reliableActions: options.reliableActions });
    }
    if (options.media || options.uploadModes)
        add('media.private', options.uploadModes ? { modes: options.uploadModes.split(',') } : {});
    if (options.notes)
        add('example.notes');
    for (const provider of options.push?.split(',') ?? [])
        add(`push.${provider}`);
    if (options.diagnostics ||
        options.mcp ||
        options.vector ||
        options.logdy ||
        options.evidenceSources ||
        options.testEvidence ||
        options.diagnosticReader)
        add('diagnostics.local', {
            ...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
            ...(options.vector !== undefined ? { vector: options.vector } : {}),
            ...(options.logdy !== undefined ? { logdy: options.logdy } : {}),
            ...(options.evidenceSources
                ? { sources: options.evidenceSources.split(',') }
                : {}),
            ...(options.testEvidence !== undefined
                ? { testCapture: options.testEvidence }
                : {}),
            ...(options.diagnosticReader ? { reader: options.diagnosticReader } : {}),
        });
    return selected;
}
//# sourceMappingURL=selection-options.js.map
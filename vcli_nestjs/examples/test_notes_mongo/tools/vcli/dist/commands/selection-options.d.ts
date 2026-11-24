import type { JsonObject, RecipeCatalog, RecipeSelection } from '../contracts.js';
export interface SelectionOptions {
    database?: string;
    auth?: string;
    localIdentifier?: string;
    mail?: string;
    reliableActions?: boolean;
    storage?: string;
    realtime?: string;
    realtimeScale?: string;
    push?: string;
    media?: boolean;
    notes?: boolean;
    uploadModes?: string;
    diagnostics?: boolean;
    mcp?: boolean;
    vector?: boolean;
    logdy?: boolean;
    evidenceSources?: string;
    testEvidence?: boolean;
    diagnosticReader?: string;
    deploy?: string;
    firebaseMethods?: string;
    actionDelivery?: string;
    with?: string[];
    options?: string;
}
export declare function parseOptions(value: string | undefined): JsonObject;
export declare function selectRecipes(catalog: RecipeCatalog, options: SelectionOptions, mainRecipe?: string): Record<string, RecipeSelection>;

export interface RecipeGuide {
    summary: string;
    defaults: string[];
    prerequisites: string[];
    conditional: string[];
    examples: string[];
}
export declare function recipeGuide(id: string): RecipeGuide;

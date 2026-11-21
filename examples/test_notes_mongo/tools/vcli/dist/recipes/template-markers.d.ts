/** Guarded template marker helpers. Missing markers fail loudly instead of slicing from -1. */
export declare function requireIndex(source: string, marker: string, template: string, fromIndex?: number): number;
export declare function replaceExact(source: string, target: string, replacement: string, template: string): string;
export declare function removeBetween(source: string, startMarker: string, endMarker: string, template: string): string;
export declare function sliceFrom(source: string, marker: string, template: string): string;

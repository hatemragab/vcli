/** Read-only owner lookup. Older locks without provenance say unknown. */
export declare function explainPath(root: string, relative: string): Promise<Record<string, unknown>>;

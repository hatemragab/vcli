export interface LastResult {
    schemaVersion: 1;
    at: string;
    operationId?: string;
    scope: 'install' | 'check' | 'focused-check' | 'release';
    status: 'completed' | 'failed';
    step?: string;
    script?: string;
    exitCode?: number | null;
    signal?: string;
    code?: string;
    rerun?: string;
}
export declare function validateLastResult(value: unknown): LastResult | undefined;
/** Separate from the recovery journal so a check fact cannot rewrite source history. */
export declare function writeLastResult(projectDir: string, result: LastResult): Promise<void>;
export declare function readLastResult(projectDir: string): Promise<LastResult | undefined>;

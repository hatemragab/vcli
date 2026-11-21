export declare class CliError extends Error {
    readonly code: string;
    readonly action: string;
    constructor(code: string, action: string);
}

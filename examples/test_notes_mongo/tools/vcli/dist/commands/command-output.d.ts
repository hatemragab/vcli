export interface CommandError {
    code: string;
    action: string;
    stage?: string;
    [key: string]: unknown;
}
export interface CommandResult {
    schemaVersion: 1;
    status: 'completed' | 'pending' | 'failed' | 'preview';
    operation: string;
    data?: unknown;
    errors?: CommandError[];
}
/** Text mode names the outcome and key summary lines. JSON stays the full envelope. */
export declare function writeResult(result: CommandResult, json: boolean, verbose?: boolean): void;
/** Raw parser/provider/process errors can contain private input; expose fixed facts. */
export declare function publicError(error: unknown): NonNullable<CommandResult['errors']>[number];

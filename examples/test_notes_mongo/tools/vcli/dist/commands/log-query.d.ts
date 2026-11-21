export interface LogQueryOptions {
    action: 'status' | 'query';
    requestId?: string;
    operationId?: string;
    configFile?: string;
    dryRun?: boolean;
    environment: NodeJS.ProcessEnv;
}
/** Read retained evidence through the generated reader. No new collector is started. */
export declare function queryLogs(root: string, options: LogQueryOptions): Promise<Record<string, unknown>>;

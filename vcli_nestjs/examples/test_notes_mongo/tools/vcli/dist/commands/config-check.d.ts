/** Startup schema and dotenv precedence. Dry-run lists selected names and does not read the file. */
export declare function checkSelectedConfig(root: string, options: {
    configFile?: string;
    dryRun?: boolean;
}): Promise<Record<string, unknown>>;

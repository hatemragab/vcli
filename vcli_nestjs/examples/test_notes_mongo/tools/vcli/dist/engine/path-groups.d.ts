export interface PathGroups {
    app: number;
    assets: number;
    tooling: number;
}
export declare function groupPaths(paths: readonly string[]): PathGroups;

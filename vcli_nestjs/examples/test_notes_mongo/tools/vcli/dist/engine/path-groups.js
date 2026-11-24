export function groupPaths(paths) {
    const groups = { app: 0, assets: 0, tooling: 0 };
    for (const path of paths) {
        if (path.startsWith('tools/'))
            groups.tooling += 1;
        else if (path.startsWith('src/') ||
            path.startsWith('test/') ||
            path.startsWith('migrations/'))
            groups.app += 1;
        else
            groups.assets += 1;
    }
    return groups;
}
//# sourceMappingURL=path-groups.js.map
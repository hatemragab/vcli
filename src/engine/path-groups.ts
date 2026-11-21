export interface PathGroups {
  app: number;
  assets: number;
  tooling: number;
}

export function groupPaths(paths: readonly string[]): PathGroups {
  const groups: PathGroups = { app: 0, assets: 0, tooling: 0 };
  for (const path of paths) {
    if (path.startsWith('tools/')) groups.tooling += 1;
    else if (
      path.startsWith('src/') ||
      path.startsWith('test/') ||
      path.startsWith('migrations/')
    )
      groups.app += 1;
    else groups.assets += 1;
  }
  return groups;
}

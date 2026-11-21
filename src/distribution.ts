import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import type { RecipeCatalog, RenderedFile } from './contracts.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

async function filesUnder(
  directory: string,
  base = packageRoot,
  prefix = 'tools/vcli',
): Promise<RenderedFile[]> {
  const files: RenderedFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('INVALID_DISTRIBUTION');
    if (entry.isDirectory())
      files.push(...(await filesUnder(path, base, prefix)));
    else if (entry.isFile() && !entry.name.endsWith('.map'))
      files.push({
        path: `${prefix}/${relative(base, path).split('\\').join('/')}`,
        content: await readFile(path, 'utf8'),
        ownership: 'managed',
        provenance: { renderer: 'distribution' },
      });
  }
  return files;
}

/** Local private distribution pins executable code without unpublished registry names or host paths. */
export function withLocalDistribution(catalog: RecipeCatalog): RecipeCatalog {
  return {
    recipes: catalog.recipes,
    async render(config, resolved) {
      const rendered = await catalog.render(config, resolved);
      const pkgFile = rendered.files.find(
        (file) => file.path === 'package.json',
      );
      if (!pkgFile) throw new Error('INVALID_DISTRIBUTION');
      const projectPackage: Record<string, unknown> = JSON.parse(
        pkgFile.content,
      );
      projectPackage.devDependencies = {
        ...(projectPackage.devDependencies as
          Record<string, string> | undefined),
        '@vcli/cli': 'file:tools/vcli',
      };
      const authAssets = join(packageRoot, 'runtime-packages/auth-runtime');
      if (config.capabilities.auth) {
        projectPackage.dependencies = {
          ...(projectPackage.dependencies as
            Record<string, string> | undefined),
          '@vcli/auth-runtime': 'file:tools/vcli-auth-runtime',
        };
        rendered.files.push(
          ...(await filesUnder(
            authAssets,
            authAssets,
            'tools/vcli-auth-runtime',
          )),
        );
      }
      pkgFile.content = `${JSON.stringify(projectPackage, null, 2)}\n`;
      const ownPackage: Record<string, unknown> = JSON.parse(
        await readFile(join(packageRoot, 'package.json'), 'utf8'),
      );
      const vendorPackage = {
        name: ownPackage.name,
        version: ownPackage.version,
        private: true,
        type: 'module',
        bin: ownPackage.bin,
        engines: ownPackage.engines,
        dependencies: ownPackage.dependencies,
      };
      const vendored = (
        await Promise.all(
          ['bin', 'dist', 'templates', 'runtime-packages'].map((dir) =>
            filesUnder(join(packageRoot, dir)),
          ),
        )
      ).flat();
      rendered.files.push(
        {
          path: 'tools/vcli/package.json',
          content: `${JSON.stringify(vendorPackage, null, 2)}\n`,
          ownership: 'managed',
          provenance: { renderer: 'distribution' },
        },
        ...vendored,
      );
      return rendered;
    },
  };
}

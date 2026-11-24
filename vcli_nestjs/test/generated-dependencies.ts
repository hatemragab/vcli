import { access, lstat, readlink, symlink, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const generatedDependenciesRoot = fileURLToPath(
  new URL('../node_modules', import.meta.url),
);

export async function linkGeneratedDependencies(projectRoot: string) {
  await access(
    join(generatedDependenciesRoot, '@nestjs/core/package.json'),
  ).catch((cause: unknown) => {
    throw new Error(
      'Generated project tests need the VCLI root dependencies. Run npm ci and npm run build at the VCLI root.',
      { cause },
    );
  });

  const target = join(projectRoot, 'node_modules');
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (existing) {
    if (!existing.isSymbolicLink())
      throw new Error(`Expected a fixture dependency symlink at ${target}`);
    if (
      resolve(projectRoot, await readlink(target)) === generatedDependenciesRoot
    )
      return;
    await unlink(target);
  }
  await symlink(generatedDependenciesRoot, target, 'dir');
}

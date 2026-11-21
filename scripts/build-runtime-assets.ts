import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const rootManifest: Record<string, unknown> = JSON.parse(
  await readFile(resolve('package.json'), 'utf8'),
);
const source = resolve('packages/auth-runtime');
const target = resolve('runtime-packages/auth-runtime');
const manifest: Record<string, unknown> = JSON.parse(
  await readFile(join(source, 'package.json'), 'utf8'),
);
if (
  manifest.name !== '@vcli/auth-runtime' ||
  manifest.version !== rootManifest.version
)
  throw new Error('UNSUPPORTED_AUTH_RUNTIME_DISTRIBUTION');
// This exact directory contains build-owned distribution assets, never user configuration.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const publicManifest = Object.fromEntries(
  [
    'name',
    'version',
    'private',
    'type',
    'description',
    'license',
    'engines',
    'files',
    'exports',
    'peerDependencies',
    'peerDependenciesMeta',
  ].map((key) => [key, manifest[key]]),
);
await writeFile(
  join(target, 'package.json'),
  `${JSON.stringify(publicManifest, null, 2)}\n`,
);
async function rejectSymlinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('UNSAFE_RUNTIME_ASSET');
    if (entry.isDirectory()) await rejectSymlinks(join(directory, entry.name));
  }
}
await rejectSymlinks(join(source, 'dist'));
await cp(join(source, 'dist'), join(target, 'dist'), { recursive: true });
for (const filename of ['README.md', 'LICENSE-NOTICE.md'])
  await cp(join(source, filename), join(target, filename));
process.stdout.write('Bundled versioned optional-peer auth runtime assets.\n');

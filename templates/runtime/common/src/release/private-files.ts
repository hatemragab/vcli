import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';

export function safeAbsolutePath(value: string): string {
  if (
    !value ||
    value.includes('\0') ||
    value.split(/[\\/]/).includes('..') ||
    value.includes('\\')
  )
    throw new Error('UNSAFE_OPERATION_PATH');
  const path = resolve(value);
  if (path === parse(path).root) throw new Error('UNSAFE_OPERATION_PATH');
  return path;
}
export function contained(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
  );
}
export function assertDisjoint(paths: readonly string[]): void {
  for (const [index, path] of paths.entries())
    for (const other of paths.slice(index + 1))
      if (contained(path, other) || contained(other, path))
        throw new Error('OVERLAPPING_OPERATION_PATHS');
}
export async function assertNoSymlinkPath(path: string): Promise<void> {
  const absolute = safeAbsolutePath(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('SYMLINK_OPERATION_PATH');
  }
}
export async function assertPrivateDirectory(path: string): Promise<string> {
  const absolute = safeAbsolutePath(path);
  await assertNoSymlinkPath(absolute);
  const stat = await lstat(absolute);
  if (
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('PRIVATE_DIRECTORY_REQUIRED');
  return absolute;
}
export async function createPrivateDirectory(path: string): Promise<string> {
  const absolute = safeAbsolutePath(path);
  await assertPrivateDirectory(dirname(absolute));
  await mkdir(absolute, { mode: 0o700 }); // EEXIST refuses all overwrites, including symlinks.
  return assertPrivateDirectory(absolute);
}
export async function openPrivateFile(path: string) {
  await assertNoSymlinkPath(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stat = await handle.stat();
  if (
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    await handle.close();
    throw new Error('PRIVATE_FILE_REQUIRED');
  }
  return handle;
}
export async function writePrivateFile(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  await assertPrivateDirectory(dirname(path));
  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let incomplete = false;
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    incomplete = true;
    throw error;
  } finally {
    try {
      await handle.close();
    } finally {
      if (incomplete) await rm(path, { force: true });
    }
  }
}
export async function readPrivateJson(path: string): Promise<unknown> {
  const handle = await openPrivateFile(path);
  try {
    if ((await handle.stat()).size > 4 * 1024 * 1024)
      throw new Error('OPERATION_PROFILE_TOO_LARGE');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}
export type SnapshotEntry = {
  path: string;
  kind: 'file' | 'directory';
  size: number;
};
export async function enumeratePrivateRoot(
  root: string,
  maximumFiles: number,
  maximumBytes: number,
): Promise<SnapshotEntry[]> {
  await assertPrivateDirectory(root);
  const entries: SnapshotEntry[] = [];
  let bytes = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      if (name === '.' || name === '..' || name.includes('\\'))
        throw new Error('UNSAFE_SNAPSHOT_ENTRY');
      const absolute = join(directory, name),
        stat = await lstat(absolute);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw new Error('UNSAFE_SNAPSHOT_ENTRY');
      bytes += stat.isFile() ? stat.size : 0;
      if (entries.length >= maximumFiles || bytes > maximumBytes)
        throw new Error('BACKUP_LIMIT_EXCEEDED');
      if ((stat.mode & 0o077) !== 0)
        throw new Error('PRIVATE_SNAPSHOT_ENTRY_REQUIRED');
      entries.push({
        path: relative(root, absolute).split(sep).join('/'),
        kind: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
      });
      if (stat.isDirectory()) await walk(absolute);
    }
  };
  await walk(root);
  return entries;
}

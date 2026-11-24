import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TargetProfile } from './types.js';
import { fail, validateProfile } from './validation.js';

export async function validatePrivateAncestors(path: string): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) fail('INVALID_PRIVATE_PATH');
  let cursor = parse(path).root;
  for (const segment of path.slice(cursor.length).split('/').filter(Boolean)) {
    cursor = join(cursor, segment);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('UNSAFE_PRIVATE_PATH');
  }
}
export async function readPrivateJson(path: string): Promise<unknown> {
  try {
    await validatePrivateAncestors(dirname(path));
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 ||
        stat.size > 1024 * 1024
      )
        fail('UNSAFE_PRIVATE_FILE');
      return JSON.parse(await handle.readFile('utf8')) as unknown;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /^(UNSAFE_|INVALID_PRIVATE)/.test(error.message)
    )
      throw error;
    fail('PRIVATE_FILE_UNAVAILABLE');
  }
}
export async function loadTargetProfile(path: string): Promise<TargetProfile> {
  return validateProfile(await readPrivateJson(path));
}
export async function ensureJournalDirectory(path: string): Promise<void> {
  try {
    await validatePrivateAncestors(dirname(path));
    await mkdir(path, { mode: 0o700 }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    await validatePrivateAncestors(path);
    const stat = await lstat(path);
    if (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700)
      fail('UNSAFE_JOURNAL_DIRECTORY');
  } catch (error) {
    if (
      error instanceof Error &&
      /^(UNSAFE_|INVALID_PRIVATE)/.test(error.message)
    )
      throw error;
    fail('JOURNAL_DIRECTORY_UNAVAILABLE');
  }
}
export async function readOptional(path: string): Promise<unknown | undefined> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    fail('PRIVATE_FILE_UNAVAILABLE');
  }
  return readPrivateJson(path);
}
export async function writePrivateJson(
  path: string,
  value: unknown,
): Promise<void> {
  await ensureJournalDirectory(dirname(path));
  // Validate any existing target before replacement.
  await readOptional(path);
  const tmp = join(dirname(path), '.write-' + randomUUID());
  const handle = await open(
    tmp,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(JSON.stringify(value) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
    const directory = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
export async function acquireLock(
  path: string,
  planId: string,
): Promise<string> {
  await ensureJournalDirectory(dirname(path));
  const id = randomUUID();
  let handle;
  try {
    handle = await open(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    fail('DEPLOYMENT_LOCK_HELD_RECONCILIATION_REQUIRED');
  }
  try {
    await handle.writeFile(JSON.stringify({ id, planId }) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return id;
}
export async function releaseLock(path: string, id: string): Promise<void> {
  const lock = await readOptional(path);
  if (lock === undefined) return;
  if (!lock || typeof lock !== 'object' || !('id' in lock) || lock.id !== id)
    fail('DEPLOYMENT_LOCK_ID_MISMATCH');
  await unlink(path);
}

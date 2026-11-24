import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { UploadEvidence } from './storage.entity.js';

export function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT',
  );
}

export class PrivateFilesystem {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  async initialize(): Promise<void> {
    const segments = this.root
      .slice(parse(this.root).root.length)
      .split(sep)
      .filter(Boolean);
    let current = parse(this.root).root;
    for (const segment of segments) {
      current = join(current, segment);
      await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EEXIST'
        ))
          throw error;
      });
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
    }
    const root = await lstat(this.root);
    if (
      (root.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && root.uid !== process.getuid())
    )
      throw new ApplicationError('STORAGE_ROOT_MUST_BE_PRIVATE', 500);
    for (const area of ['incoming', 'objects']) {
      const path = join(this.root, area);
      await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EEXIST'
        ))
          throw error;
      });
      const stat = await lstat(path);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0
      )
        throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
    }
  }

  async path(area: 'incoming' | 'objects', id: string): Promise<string> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        id,
      )
    )
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 400);
    const target = join(this.root, area, id);
    const offset = relative(this.root, target);
    if (offset.startsWith(`..${sep}`) || isAbsolute(offset))
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 400);
    // Verify every ancestor on each operation; the private root must not be renamed/writable by other principals.
    let ancestor = dirname(target);
    while (true) {
      const stat = await lstat(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
      if (ancestor === dirname(ancestor)) break;
      ancestor = dirname(ancestor);
    }
    if ((await realpath(dirname(target))) !== dirname(target))
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
    return target;
  }

  async create(id: string): Promise<FileHandle> {
    return open(
      await this.path('incoming', id),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  }

  async read(area: 'incoming' | 'objects', id: string): Promise<FileHandle> {
    const handle = await open(
      await this.path(area, id),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink > (area === 'objects' ? 2 : 1)) {
      await handle.close();
      throw new ApplicationError('UNSAFE_STORAGE_FILE', 500);
    }
    return handle;
  }

  async evidence(
    area: 'incoming' | 'objects',
    id: string,
    maximum: number,
  ): Promise<UploadEvidence> {
    const handle = await this.read(area, id);
    const sha = createHash('sha256');
    const md5 = createHash('md5');
    let bytes = 0;
    try {
      for await (const chunk of handle.createReadStream()) {
        bytes += chunk.length;
        if (bytes > maximum)
          throw new ApplicationError('UPLOAD_SIZE_MISMATCH', 422);
        sha.update(chunk);
        md5.update(chunk);
      }
    } finally {
      await handle.close();
    }
    return { bytes, sha256: sha.digest('hex'), md5: md5.digest('base64') };
  }

  async promote(id: string): Promise<void> {
    const source = await this.path('incoming', id);
    const target = await this.path('objects', id);
    const handle = await this.read('incoming', id);
    try {
      await handle.chmod(0o400);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(source, target); // Atomic exclusive link: an existing committed destination is never replaced.
    await chmod(target, 0o400);
    await this.remove('incoming', id);
  }

  async remove(area: 'incoming' | 'objects', id: string): Promise<void> {
    const path = await this.path(area, id);
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new ApplicationError('UNSAFE_STORAGE_FILE', 500);
      await unlink(path);
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
    }
  }
}

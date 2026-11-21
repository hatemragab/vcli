import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, parse, resolve, sep } from 'node:path';
import { ApplicationError } from '../../core/errors/application-error.js';
import { boundedStream } from './bounded-stream.js';
import { STORAGE_LIMITS, type UploadEvidence } from './storage.entity.js';
type Area = 'incoming' | 'objects';
export function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT',
  );
}
function exists(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST',
  );
}
/** Linux proc-fd anchors preserve no-follow directory lookup across rename races.
 * Private storage is same-user infrastructure, not a sandbox against its OS owner.
 */
export class PrivateFilesystem {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private fdPath(handle: FileHandle, child = ''): string {
    return `/proc/self/fd/${handle.fd}${child ? `/${child}` : ''}`;
  }
  private validateId(id: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        id,
      )
    )
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 400);
  }
  private async directory(
    path: string,
    privateMode: boolean,
  ): Promise<FileHandle> {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isDirectory() ||
        (privateMode &&
          ((stat.mode & 0o077) !== 0 ||
            (typeof process.getuid === 'function' &&
              stat.uid !== process.getuid())))
      )
        throw new ApplicationError('STORAGE_ROOT_MUST_BE_PRIVATE', 500);
      return handle;
    } catch (error: unknown) {
      await handle.close();
      throw error;
    }
  }
  private async openRoot(create = false): Promise<FileHandle> {
    if (process.platform !== 'linux')
      throw new ApplicationError('UNSUPPORTED_PRIVATE_FILESYSTEM', 500);
    const segments = this.root
      .slice(parse(this.root).root.length)
      .split(sep)
      .filter(Boolean);
    if (!segments.length)
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
    let current = await this.directory(parse(this.root).root, false);
    try {
      for (let index = 0; index < segments.length; index += 1) {
        const path = this.fdPath(current, segments[index]);
        if (create)
          await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
            if (!exists(error)) throw error;
          });
        const next = await this.directory(path, index === segments.length - 1);
        await current.close();
        current = next;
      }
      return current;
    } catch (error: unknown) {
      await current.close();
      throw error;
    }
  }
  private async area(
    root: FileHandle,
    area: Area,
    create = false,
  ): Promise<FileHandle> {
    if (!['incoming', 'objects'].includes(area))
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 400);
    const path = this.fdPath(root, area);
    if (create)
      await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
        if (!exists(error)) throw error;
      });
    return this.directory(path, true);
  }
  private async withinArea<T>(
    area: Area,
    id: string,
    action: (path: string) => Promise<T>,
  ): Promise<T> {
    this.validateId(id);
    const root = await this.openRoot();
    let directory: FileHandle | undefined;
    try {
      directory = await this.area(root, area);
      return await action(this.fdPath(directory, id));
    } finally {
      await directory?.close();
      await root.close();
    }
  }
  async initialize(): Promise<void> {
    const root = await this.openRoot(true);
    try {
      for (const area of ['incoming', 'objects'] as const) {
        const directory = await this.area(root, area, true);
        await directory.close();
      }
    } finally {
      await root.close();
    }
  }
  /** Informational path only; all I/O below uses pinned directory descriptors. */
  async path(area: Area, id: string): Promise<string> {
    return this.withinArea(area, id, async () => join(this.root, area, id));
  }
  async create(id: string): Promise<FileHandle> {
    return this.withinArea('incoming', id, (path) =>
      open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      ),
    );
  }
  private async readPath(path: string, area: Area): Promise<FileHandle> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink > (area === 'objects' ? 2 : 1) ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      )
        throw new ApplicationError('UNSAFE_STORAGE_FILE', 500);
      return handle;
    } catch (error: unknown) {
      await handle.close();
      throw error;
    }
  }
  async read(area: Area, id: string): Promise<FileHandle> {
    return this.withinArea(area, id, (path) => this.readPath(path, area));
  }
  async evidence(
    area: Area,
    id: string,
    maximum: number,
  ): Promise<UploadEvidence> {
    const handle = await this.read(area, id);
    const source = handle.createReadStream();
    const sha = createHash('sha256'),
      md5 = createHash('md5');
    let bytes = 0;
    try {
      for await (const chunk of boundedStream(
        source,
        maximum,
        AbortSignal.timeout(STORAGE_LIMITS.transferMs),
      )) {
        bytes += chunk.byteLength;
        sha.update(chunk);
        md5.update(chunk);
      }
    } finally {
      source.destroy();
      await handle.close();
    }
    return { bytes, sha256: sha.digest('hex'), md5: md5.digest('base64') };
  }
  async promote(id: string): Promise<void> {
    this.validateId(id);
    const root = await this.openRoot();
    let incoming: FileHandle | undefined, objects: FileHandle | undefined;
    try {
      incoming = await this.area(root, 'incoming');
      objects = await this.area(root, 'objects');
      const source = this.fdPath(incoming, id),
        target = this.fdPath(objects, id);
      const handle = await this.readPath(source, 'incoming');
      try {
        await handle.chmod(0o400);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(source, target); // Create-only destination; the client never receives its path.
      await chmod(target, 0o400);
      await unlink(source);
      await objects.sync();
      await incoming.sync();
    } finally {
      await objects?.close();
      await incoming?.close();
      await root.close();
    }
  }
  async remove(area: Area, id: string): Promise<void> {
    await this.withinArea(area, id, async (path) => {
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new ApplicationError('UNSAFE_STORAGE_FILE', 500);
        await unlink(path);
      } catch (error: unknown) {
        if (!isMissing(error)) throw error;
      }
    });
  }
}

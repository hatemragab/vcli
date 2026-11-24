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
type Directory = Readonly<{ handle: FileHandle; path: string }>;
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
/** Linux anchors lookups to open directory descriptors. macOS uses no-follow
 * directory opens and paths writable only by the trusted current user and root.
 * Private storage trusts its OS owner, including any access granted through ACLs.
 */
export class PrivateFilesystem {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private childPath(directory: Directory, child: string): string {
    return process.platform === 'linux'
      ? `/proc/self/fd/${directory.handle.fd}/${child}`
      : join(directory.path, child);
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
  ): Promise<Directory> {
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
      if (process.platform === 'darwin') {
        const trustedOwner = stat.uid === 0 || stat.uid === process.getuid?.();
        // Sticky directories owned by root protect each checked child from
        // replacement by the other users who can create entries there.
        const rootSticky = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
        if (!trustedOwner || ((stat.mode & 0o022) !== 0 && !rootSticky))
          throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
      }
      return { handle, path };
    } catch (error: unknown) {
      await handle.close();
      throw error;
    }
  }
  private async openRoot(create = false): Promise<Directory> {
    if (process.platform !== 'linux' && process.platform !== 'darwin')
      throw new ApplicationError('UNSUPPORTED_PRIVATE_FILESYSTEM', 500);
    const segments = this.root
      .slice(parse(this.root).root.length)
      .split(sep)
      .filter(Boolean);
    if (!segments.length)
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 500);
    let current = await this.directory(parse(this.root).root, false);
    try {
      for (const [index, segment] of segments.entries()) {
        const path = this.childPath(current, segment);
        if (create)
          await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
            if (!exists(error)) throw error;
          });
        const next = await this.directory(path, index === segments.length - 1);
        await current.handle.close();
        current = next;
      }
      return current;
    } catch (error: unknown) {
      await current.handle.close();
      throw error;
    }
  }
  private async area(
    root: Directory,
    area: Area,
    create = false,
  ): Promise<Directory> {
    if (!['incoming', 'objects'].includes(area))
      throw new ApplicationError('UNSAFE_STORAGE_PATH', 400);
    const path = this.childPath(root, area);
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
    let directory: Directory | undefined;
    try {
      directory = await this.area(root, area);
      return await action(this.childPath(directory, id));
    } finally {
      await directory?.handle.close();
      await root.handle.close();
    }
  }
  async initialize(): Promise<void> {
    const root = await this.openRoot(true);
    try {
      for (const area of ['incoming', 'objects'] as const) {
        const directory = await this.area(root, area, true);
        await directory.handle.close();
      }
    } finally {
      await root.handle.close();
    }
  }
  /** Informational path only; use the checked storage operations for I/O. */
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
    let incoming: Directory | undefined, objects: Directory | undefined;
    try {
      incoming = await this.area(root, 'incoming');
      objects = await this.area(root, 'objects');
      const source = this.childPath(incoming, id),
        target = this.childPath(objects, id);
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
      await objects.handle.sync();
      await incoming.handle.sync();
    } finally {
      await objects?.handle.close();
      await incoming?.handle.close();
      await root.handle.close();
    }
  }
  async remove(area: Area, id: string): Promise<void> {
    try {
      await this.withinArea(area, id, async (path) => {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new ApplicationError('UNSAFE_STORAGE_FILE', 500);
        await unlink(path);
      });
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
    }
  }
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  assertNoSymlinkPath,
  assertPrivateDirectory,
  openPrivateFile,
} from './private-files.js';

const header = Buffer.from('VCLIBK01');
async function createOutput(path: string): Promise<FileHandle> {
  await assertPrivateDirectory(dirname(path));
  return open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
}
export async function readArchiveKey(path: string): Promise<Buffer> {
  const file = await openPrivateFile(path);
  try {
    if ((await file.stat()).size !== 32)
      throw new Error('ARCHIVE_KEY_MUST_BE_32_BYTES');
    return await file.readFile();
  } finally {
    await file.close();
  }
}

/** Fixed-size buffers bound memory and keep descriptor ownership explicit throughout authentication. */
export async function sealFile(
  source: string,
  target: string,
  key: Buffer,
  aad: string,
  maximumBytes: number,
): Promise<number> {
  await assertNoSymlinkPath(source);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: FileHandle | undefined;
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size > maximumBytes)
      throw new Error('BACKUP_LIMIT_EXCEEDED');
    output = await createOutput(target);
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad));
    await output.writeFile(Buffer.concat([header, iv]));
    const buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (true) {
      const result = await input.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > maximumBytes) throw new Error('BACKUP_LIMIT_EXCEEDED');
      await output.writeFile(
        cipher.update(buffer.subarray(0, result.bytesRead)),
      );
    }
    const after = await input.stat();
    if (
      bytes !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs
    )
      throw new Error('SNAPSHOT_CHANGED_DURING_BACKUP');
    await output.writeFile(cipher.final());
    await output.writeFile(cipher.getAuthTag());
    await output.sync();
    buffer.fill(0);
    return bytes;
  } finally {
    try {
      await input.close();
    } finally {
      if (output) await output.close();
    }
  }
}
export async function unsealFile(
  source: string,
  target: string,
  key: Buffer,
  aad: string,
  maximumBytes: number,
): Promise<number> {
  const input = await openPrivateFile(source);
  let output: FileHandle | undefined;
  try {
    const stat = await input.stat();
    if (stat.size < 36 || stat.size - 36 > maximumBytes)
      throw new Error('INVALID_BACKUP_PAYLOAD');
    const prefix = Buffer.alloc(20),
      tag = Buffer.alloc(16);
    if (
      (await input.read(prefix, 0, 20, 0)).bytesRead !== 20 ||
      (await input.read(tag, 0, 16, stat.size - 16)).bytesRead !== 16 ||
      !prefix.subarray(0, 8).equals(header)
    )
      throw new Error('INVALID_BACKUP_PAYLOAD');
    const decipher = createDecipheriv('aes-256-gcm', key, prefix.subarray(8));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    output = await createOutput(target);
    const buffer = Buffer.alloc(65536);
    let offset = 20;
    while (offset < stat.size - 16) {
      const result = await input.read(
        buffer,
        0,
        Math.min(buffer.length, stat.size - 16 - offset),
        offset,
      );
      if (!result.bytesRead) throw new Error('INVALID_BACKUP_PAYLOAD');
      offset += result.bytesRead;
      await output.writeFile(
        decipher.update(buffer.subarray(0, result.bytesRead)),
      );
    }
    await output.writeFile(decipher.final());
    await output.sync();
    buffer.fill(0);
    return stat.size - 36;
  } finally {
    try {
      await input.close();
    } finally {
      if (output) await output.close();
    }
  }
}

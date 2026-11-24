import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function readPushCredential(
  path: string,
  maximumBytes: number,
): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximumBytes || (stat.mode & 0o077) !== 0)
      throw new Error('PRIVATE_CREDENTIAL_REQUIRED');
    const bytes = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximumBytes) throw new Error('CREDENTIAL_TOO_LARGE');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/** Explicit same-user configuration file only; not callable through a diagnostic query. */
export async function readPrivateDiagnosticProfile(path) {
  let file;
  try {
    if (!path || path.length > 4096) throw new Error();
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (
      !stat.isFile() ||
      stat.size > 16384 ||
      (stat.mode & 0o077) !== 0 ||
      (process.geteuid && stat.uid !== process.geteuid())
    )
      throw new Error();
    const bytes = Buffer.alloc(16385);
    const result = await file.read(bytes, 0, bytes.length, 0);
    if (result.bytesRead > 16384) throw new Error();
    return JSON.parse(bytes.subarray(0, result.bytesRead).toString('utf8'));
  } catch {
    throw new Error('INVALID_PRIVATE_DIAGNOSTIC_PROFILE');
  } finally {
    await file?.close();
  }
}

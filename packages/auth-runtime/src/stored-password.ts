import { AuthRuntimeError } from './errors.js';

/** Strict PHC shape/resource validation runs before node-argon2 sees stored input. */
export function inspectStoredPassword(hash: string): {
  saltLength: number;
  hashLength: number;
} {
  if (typeof hash !== 'string' || hash.length > 256)
    throw new AuthRuntimeError('CREDENTIAL_STORAGE_INVALID');
  const match =
    /^\$argon2id\$v=19\$m=([1-9]\d{0,4}),t=([1-5]),p=([1-2])\$([A-Za-z0-9+/]{11,86})\$([A-Za-z0-9+/]{22,86})$/u.exec(
      hash,
    );
  if (!match) throw new AuthRuntimeError('CREDENTIAL_STORAGE_INVALID');
  const memory = Number(match[1]);
  const parallelism = Number(match[3]);
  const salt = match[4]!;
  const digest = match[5]!;
  const saltBytes = Buffer.from(salt, 'base64');
  const hashBytes = Buffer.from(digest, 'base64');
  if (
    memory > 65536 ||
    memory < 8 * parallelism ||
    saltBytes.length < 8 ||
    saltBytes.length > 64 ||
    hashBytes.length < 16 ||
    hashBytes.length > 64 ||
    saltBytes.toString('base64').replace(/=+$/u, '') !== salt ||
    hashBytes.toString('base64').replace(/=+$/u, '') !== digest
  )
    throw new AuthRuntimeError('CREDENTIAL_STORAGE_INVALID');
  return { saltLength: saltBytes.length, hashLength: hashBytes.length };
}

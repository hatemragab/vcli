import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthRuntimeError } from './errors.js';

const purposes = [
  'refresh-token',
  'session-capability',
  'installation-capability',
  'action-token',
  'realtime-ticket',
] as const;
export type OpaquePurpose = (typeof purposes)[number];

/** Exactly 256 random bits; canonical unpadded base64url, always 43 characters. */
export function createOpaqueCapability(): string {
  try {
    return randomBytes(32).toString('base64url');
  } catch {
    throw new AuthRuntimeError('CRYPTO_FAILURE');
  }
}

export function hashOpaqueCapability(
  capability: string,
  purpose: OpaquePurpose,
): string {
  if (!purposes.includes(purpose))
    throw new AuthRuntimeError('INVALID_OPAQUE_PURPOSE');
  if (
    typeof capability !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/u.test(capability)
  )
    throw new AuthRuntimeError('INVALID_OPAQUE_CAPABILITY');
  const bytes = Buffer.from(capability, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== capability)
    throw new AuthRuntimeError('INVALID_OPAQUE_CAPABILITY');
  return createHash('sha256')
    .update(`vcli.auth-runtime:v1:${purpose}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

/** Constant-time comparison of equal-size decoded hashes, after format checks. */
export function opaqueCapabilityMatches(
  capability: string,
  expectedHash: string,
  purpose: OpaquePurpose,
): boolean {
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedHash))
    throw new AuthRuntimeError('INVALID_CAPABILITY_HASH');
  const actualHash = hashOpaqueCapability(capability, purpose);
  return timingSafeEqual(
    Buffer.from(actualHash, 'hex'),
    Buffer.from(expectedHash, 'hex'),
  );
}

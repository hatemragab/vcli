import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SessionFacts } from '../sessions/session-facts.js';
export const secretHash = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');
export const newSecret = (): string => randomBytes(32).toString('base64url');
export const newId = (): string => randomUUID();
export function sessionFacts(
  now: number,
  ttlSeconds: number,
  platform: SessionFacts['platform'],
  secret: string,
): SessionFacts {
  return {
    now,
    sessionId: newId(),
    installationId: newId(),
    platform,
    secretHash: secretHash(secret),
    expiresAt: now + ttlSeconds * 1000,
  };
}

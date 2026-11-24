import { createHash, randomUUID } from 'node:crypto';
import {
  createOpaqueCapability,
  hashOpaqueCapability,
  type OpaquePurpose,
} from '@vcli/auth-runtime/opaque';
import { ApplicationError } from '../../core/errors/application-error.js';
import { authRuntimeError } from '../../core/auth/auth-runtime-error.js';
import type { SessionFacts } from '../sessions/session-facts.js';
export const secretHash = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');
export function newSecret(): string {
  try {
    return createOpaqueCapability();
  } catch (error) {
    return authRuntimeError(error);
  }
}
export function capabilityHash(value: string, purpose: OpaquePurpose): string {
  try {
    return hashOpaqueCapability(value, purpose);
  } catch (error) {
    return authRuntimeError(error);
  }
}
export const newId = (): string => randomUUID();
export function sessionFacts(
  now: number,
  ttlSeconds: number,
  platform: SessionFacts['platform'],
  secret: string,
  installationCapability: string,
  kind: 'local' | 'firebase' = 'local',
  allowRebind = false,
): SessionFacts {
  if (secret === installationCapability)
    throw new ApplicationError(
      'SEPARATE_INSTALLATION_CAPABILITY_REQUIRED',
      400,
    );
  return {
    now,
    sessionId: newId(),
    installationId: newId(),
    platform,
    secretHash: capabilityHash(
      secret,
      kind === 'firebase' ? 'session-capability' : 'refresh-token',
    ),
    installationCapabilityHash: capabilityHash(
      installationCapability,
      'installation-capability',
    ),
    allowRebind,
    expiresAt: now + ttlSeconds * 1000,
  };
}

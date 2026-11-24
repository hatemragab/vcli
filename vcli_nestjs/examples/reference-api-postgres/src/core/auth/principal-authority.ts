import type { AccessProof, Principal } from './principal.js';

export interface PrincipalAuthority {
  verify(proof: AccessProof): Promise<Principal>;
  current(sessionId: string): Promise<Principal>;
}

export const PRINCIPAL_AUTHORITY = Symbol('PrincipalAuthority');

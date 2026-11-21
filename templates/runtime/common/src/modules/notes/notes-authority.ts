import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { ApplicationError } from '../../core/errors/application-error.js';
/** One current-authority check per operation; revocation cannot recall already admitted I/O. */
export async function assertNotesPrincipal(
  authority: PrincipalAuthority,
  principal: Principal,
): Promise<void> {
  const current = await authority.current(principal.sessionId);
  if (
    principal.expiresAt <= Date.now() ||
    current.expiresAt <= Date.now() ||
    current.accountId !== principal.accountId ||
    current.sessionId !== principal.sessionId ||
    current.installationId !== principal.installationId ||
    current.installationGeneration !== principal.installationGeneration
  )
    throw new ApplicationError('UNAUTHENTICATED', 401);
}

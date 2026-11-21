import { ApplicationError } from '../../core/errors/application-error.js';
import type { Session } from './session.entity.js';
export function checkSession(
  session: Session | null,
  account: Readonly<{
    id: string;
    enabled: boolean;
  }> | null,
  installation: Readonly<{
    id: string;
    accountId: string;
  }> | null,
  now: number,
): asserts session is Session {
  if (!session || session.revokedAt !== null || session.expiresAt <= now)
    throw new ApplicationError('SESSION_REVOKED', 401);
  if (
    !account?.enabled ||
    account.id !== session.accountId ||
    installation?.accountId !== session.accountId ||
    installation.id !== session.installationId
  )
    throw new ApplicationError('SESSION_REVOKED', 401);
}
export function requireRecent(
  session: Session,
  now: number,
  maximumAge: number,
): void {
  if (
    session.authenticatedAt > now ||
    now - session.authenticatedAt > maximumAge
  )
    throw new ApplicationError('RECENT_AUTH_REQUIRED', 403);
}

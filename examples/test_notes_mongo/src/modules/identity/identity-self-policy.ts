import type { TransactionContext } from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import type { AccountService } from '../accounts/account.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from '../sessions/session.service.js';
import { checkSession } from '../sessions/session-policy.js';
import { ApplicationError } from '../../core/errors/application-error.js';
export async function lockSelfActor(
  actor: Principal,
  now: number,
  ctx: TransactionContext,
  accounts: AccountService,
  installations: InstallationService,
  sessions: SessionService,
) {
  const account = await accounts.lock(actor.accountId, ctx);
  const session = await sessions.findById(actor.sessionId, { context: ctx });
  checkSession(
    session,
    account,
    await installations.findById(actor.installationId, { context: ctx }),
    now,
  );
  if (
    session.accountId !== actor.accountId ||
    session.installationId !== actor.installationId ||
    session.installationGeneration !== actor.installationGeneration
  )
    throw new ApplicationError('UNAUTHENTICATED', 401);
  return session;
}

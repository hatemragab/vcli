import { Injectable } from '@nestjs/common';
import type {
  TransactionContext,
  Transactions,
} from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import type { AccountService } from '../accounts/account.service.js';
import type { SessionService } from '../sessions/session.service.js';
import type { IdentityService } from './identity.service.js';
import type {
  FreshIdentityProof,
  SelfProof,
} from './fresh-identity-proof.service.js';
import type { ProviderCleanup } from './credential-ports.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { newId } from './secret-facts.js';

type CleanupWriter = {
  stage(row: ProviderCleanup, ctx: TransactionContext): Promise<void>;
};

@Injectable()
export class AccountLifecycle {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly sessions: SessionService,
    private readonly fresh: FreshIdentityProof,
    private readonly cleanup: CleanupWriter | null,
  ) {}
  async act(
    actor: Principal,
    action: 'disable' | 'delete',
    input: SelfProof,
    now: number,
  ) {
    const proof = await this.fresh.verify(actor, input, now);
    const operationId = newId();
    const cleanupIds = this.cleanup
      ? Array.from({ length: 32 }, (_, index) =>
          index === 0 ? operationId : newId(),
        )
      : [];
    const providerCleanup = await this.tx.run(async (ctx) => {
      await this.fresh.assertCurrent(actor, proof, now, ctx);
      const identities = await this.identities.list(actor.accountId, ctx);
      if (identities.length > 32)
        throw new ApplicationError('IDENTITY_LIMIT', 409);
      let pending = false,
        cleanupIndex = 0;
      for (const identity of identities) {
        if (!identity.active && !identity.key.startsWith('firebase:')) continue;
        const external = identity.key.startsWith('firebase:');
        if (external && !this.cleanup)
          throw new ApplicationError('PROVIDER_CLEANUP_UNAVAILABLE', 503);
        const removed = await this.identities.updateLifecycle(
          identity.key,
          identity.generation,
          { active: false, methods: [], cleanupPending: external },
          ctx,
          true,
        );
        if (external && this.cleanup) {
          await this.cleanup.stage(
            {
              id: cleanupIds[cleanupIndex++]!,
              identityKey: identity.key,
              generation: removed.generation,
              action: action === 'delete' ? 'delete' : 'revoke',
              method: null,
              status: 'pending',
              attempts: 0,
              nextAttemptAt: now,
              leaseId: null,
              leaseUntil: 0,
              lastCode: 'NONE',
              createdAt: now,
              completedAt: null,
            },
            ctx,
          );
          pending = true;
        }
      }
      await this.identities.advanceCutoff(actor.accountId, now, ctx);
      await this.sessions.revokeAll(actor.accountId, now, ctx);
      await this.accounts.disable(actor.accountId, action === 'delete', ctx);
      return pending ? ('pending' as const) : ('not-required' as const);
    });
    return {
      operationId,
      status: action === 'delete' ? 'deleted-retained' : 'disabled',
      providerCleanup,
      applicationCleanup: 'required' as const,
      reauthenticate: true,
    };
  }
}

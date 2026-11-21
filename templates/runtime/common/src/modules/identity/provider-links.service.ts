import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import type { SessionService } from '../sessions/session.service.js';
import type { IdentityService } from './identity.service.js';
import type { FirebaseVerifier } from './credential-ports.js';
import type {
  FreshIdentityProof,
  SelfProof,
} from './fresh-identity-proof.service.js';
import type { ProviderCleanupService } from './provider-cleanup.service.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { newId } from './secret-facts.js';
@Injectable()
export class ProviderLinks {
  constructor(
    private readonly tx: Transactions,
    private readonly identities: IdentityService,
    private readonly sessions: SessionService,
    private readonly fresh: FreshIdentityProof,
    private readonly verifier: FirebaseVerifier,
    private readonly cleanup: ProviderCleanupService,
    private readonly projectId: string,
    private readonly methods: readonly string[],
    private readonly recentAuthMs: number,
  ) {}
  private async target(idToken: string, now: number) {
    const proof = await this.verifier.verify(idToken);
    if (
      proof.projectId !== this.projectId ||
      !this.methods.includes(proof.method) ||
      (proof.linkedMethods && !proof.linkedMethods.includes(proof.method)) ||
      proof.expiresAt <= now ||
      proof.authenticatedAt > now ||
      now - proof.authenticatedAt > this.recentAuthMs
    )
      throw new ApplicationError('RECENT_AUTH_REQUIRED', 403);
    return {
      proof,
      key: 'firebase:' + proof.projectId + ':' + proof.uid,
      methods: (proof.linkedMethods ?? [proof.method]).filter((method) =>
        this.methods.includes(method),
      ),
    };
  }
  async link(actor: Principal, self: SelfProof, idToken: string, now: number) {
    const fresh = await this.fresh.verify(actor, self, now),
      target = await this.target(idToken, now);
    await this.tx.run(async (ctx) => {
      await this.fresh.assertCurrent(actor, fresh, now, ctx);
      const current = await this.identities.find(target.key, ctx);
      if (
        current &&
        (current.accountId !== actor.accountId ||
          !current.active ||
          current.cleanupPending)
      )
        throw new ApplicationError('IDENTITY_LINK_CONFLICT', 409);
      if (current && target.proof.authenticatedAt <= current.enrollmentCutoff)
        throw new ApplicationError('REAUTHENTICATION_REQUIRED', 401);
      if (current) {
        await this.identities.updateLifecycle(
          current.key,
          current.generation,
          {
            active: true,
            cleanupPending: false,
            methods: [...new Set([...current.methods, ...target.methods])],
          },
          ctx,
        );
      } else {
        if ((await this.identities.list(actor.accountId, ctx)).length >= 32)
          throw new ApplicationError('IDENTITY_LIMIT', 409);
        await this.identities.create(
          {
            key: target.key,
            accountId: actor.accountId,
            passwordHash: null,
            credentialVersion: 1,
            enrollmentCutoff: 0,
            generation: 1,
            active: true,
            methods: target.methods,
            cleanupPending: false,
          },
          ctx,
        );
      }
    });
    return { status: 'linked', methods: target.methods };
  }
  async unlink(
    actor: Principal,
    self: SelfProof,
    idToken: string,
    method: string,
    now: number,
  ) {
    const fresh = await this.fresh.verify(actor, self, now),
      target = await this.target(idToken, now),
      operationId = newId();
    if (!this.methods.includes(method))
      throw new ApplicationError('PROVIDER_DISALLOWED', 403);
    await this.tx.run(async (ctx) => {
      await this.fresh.assertCurrent(actor, fresh, now, ctx);
      const current = await this.identities.find(target.key, ctx);
      if (
        !current?.active ||
        current.accountId !== actor.accountId ||
        current.cleanupPending ||
        !current.methods.includes(method) ||
        !target.methods.includes(method) ||
        target.proof.authenticatedAt <= current.enrollmentCutoff
      )
        throw new ApplicationError('IDENTITY_LINK_CONFLICT', 409);
      const others = (await this.identities.list(actor.accountId, ctx)).filter(
        (row) => row.active && !row.cleanupPending,
      );
      const methods = current.methods.filter(
        (value) =>
          value !== method &&
          this.methods.includes(value) &&
          target.methods.includes(value),
      );
      if (
        !others.some(
          (row) =>
            row.key !== current.key &&
            row.methods.some(
              (value) => this.methods.includes(value) && value !== 'password',
            ),
        ) &&
        !methods.some(
          (value) =>
            value !== 'password' ||
            (!!target.proof.email && target.proof.emailVerified),
        )
      )
        throw new ApplicationError('LAST_RECOVERY_METHOD', 409);
      const row = await this.identities.updateLifecycle(
        current.key,
        current.generation,
        { active: methods.length > 0, methods, cleanupPending: true },
        ctx,
        methods.length === 0,
      );
      await this.sessions.revokeIdentity(row.key, now, ctx, method);
      await this.cleanup.stage(
        {
          id: operationId,
          identityKey: row.key,
          generation: row.generation,
          action: 'unlink',
          method,
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
    });
    return {
      operationId,
      status: 'unlinked-locally',
      providerCleanup: 'pending',
    };
  }
}

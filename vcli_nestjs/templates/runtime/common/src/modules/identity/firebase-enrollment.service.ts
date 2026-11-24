import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { IdentityService } from './identity.service.js';
import type { FirebaseIdentity } from './credential-ports.js';
import type { SessionFacts } from '../sessions/session-facts.js';
import type { SessionIssuer } from '../sessions/session-issuer.service.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class FirebaseEnrollment {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly issuer: Pick<SessionIssuer, 'issue' | 'recoverFirebase'>,
    private readonly projectId: string,
    private readonly methods: readonly string[],
    private readonly recentAuthMs: number,
  ) {}
  async enroll(
    proof: FirebaseIdentity,
    accountId: string,
    facts: SessionFacts,
  ) {
    if (
      proof.projectId !== this.projectId ||
      !this.methods.includes(proof.method) ||
      (proof.linkedMethods && !proof.linkedMethods.includes(proof.method))
    )
      throw new ApplicationError('PROVIDER_DISALLOWED', 403);
    if (proof.expiresAt <= facts.now || proof.authenticatedAt > facts.now)
      throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
    const key = 'firebase:' + this.projectId + ':' + proof.uid;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.tx.run(async (ctx) => {
          let identity = await this.identities.find(key, ctx);
          if (!identity) {
            if (facts.now - proof.authenticatedAt > this.recentAuthMs)
              throw new ApplicationError('RECENT_AUTH_REQUIRED', 403);
            await this.accounts.create(
              {
                id: accountId,
                email: proof.email,
                emailVerified: proof.emailVerified,
                enabled: true,
                createdAt: facts.now,
              },
              { context: ctx },
            );
            await this.identities.create(
              {
                key,
                accountId,
                passwordHash: null,
                credentialVersion: 1,
                enrollmentCutoff: 0,
                generation: 1,
                active: true,
                methods: (proof.linkedMethods ?? [proof.method]).filter(
                  (method) => this.methods.includes(method),
                ),
                cleanupPending: false,
              },
              ctx,
            );
            identity = await this.identities.find(key, ctx);
          }
          if (!identity) throw new ApplicationError('UNAUTHENTICATED', 401);
          // All enrollments and self-revocations serialize on the same durable account authority.
          const account = await this.accounts.lock(identity.accountId, ctx);
          identity = await this.identities.find(key, ctx);
          if (!account?.enabled || !identity?.active)
            throw new ApplicationError('UNAUTHENTICATED', 401);
          const existing = await this.issuer.recoverFirebase(
            facts.secretHash,
            key,
            identity.generation,
            proof.authenticatedAt,
            facts,
            ctx,
          );
          if (existing) {
            if (!this.methods.includes(existing.method))
              throw new ApplicationError('PROVIDER_DISALLOWED', 403);
            return existing;
          }
          if (identity.cleanupPending)
            throw new ApplicationError('PROVIDER_CLEANUP_PENDING', 409);
          if (!identity.methods.includes(proof.method))
            throw new ApplicationError('PROVIDER_DISALLOWED', 403);
          if (facts.now - proof.authenticatedAt > this.recentAuthMs)
            throw new ApplicationError('RECENT_AUTH_REQUIRED', 403);
          if (proof.authenticatedAt <= identity.enrollmentCutoff)
            throw new ApplicationError('REAUTHENTICATION_REQUIRED', 401);
          return this.issuer.issue(
            account.id,
            key,
            'firebase',
            proof.method,
            proof.authenticatedAt,
            facts,
            ctx,
            identity.generation,
          );
        });
      } catch (error) {
        if (
          attempt < 2 &&
          error instanceof ApplicationError &&
          [
            'IDENTITY_EXISTS',
            'DUPLICATE_IDENTITY',
            'SESSION_EXISTS',
            'INSTALLATION_EXISTS',
          ].includes(error.code)
        )
          continue;
        throw error;
      }
    }
    throw new ApplicationError('DATABASE_BUSY', 503);
  }
}

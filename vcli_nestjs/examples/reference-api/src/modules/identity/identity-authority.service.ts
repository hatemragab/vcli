import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { AccountService } from '../accounts/account.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from '../sessions/session.service.js';
import type { Session } from '../sessions/session.entity.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type { AccessProof, Principal } from '../../core/auth/principal.js';
import type { AccessTokens, FirebaseVerifier } from './credential-ports.js';
import { checkSession } from '../sessions/session-policy.js';
import { secretHash } from './secret-facts.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class IdentityAuthority implements PrincipalAuthority {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
    private readonly profile: 'local' | 'firebase',
    private readonly methods: readonly string[],
    private readonly access: AccessTokens | null,
    private readonly firebase: FirebaseVerifier | null,
    private readonly now: () => number = Date.now,
  ) {}
  private principal(session: Session): Principal {
    return {
      accountId: session.accountId,
      sessionId: session.id,
      installationId: session.installationId,
      expiresAt: session.expiresAt,
    };
  }
  private async readCurrent(id: string): Promise<Session> {
    const now = this.now();
    return this.tx.run(async (ctx) => {
      const session = await this.sessions.findById(id, { context: ctx });
      if (!session || session.kind !== this.profile)
        throw new ApplicationError('SESSION_REVOKED', 401);
      checkSession(
        session,
        await this.accounts.findById(session.accountId, { context: ctx }),
        await this.installations.findById(session.installationId, {
          context: ctx,
        }),
        now,
      );
      if (session.kind === 'firebase' && !this.methods.includes(session.method))
        throw new ApplicationError('PROVIDER_DISALLOWED', 403);
      return session;
    });
  }
  async current(id: string): Promise<Principal> {
    let session = await this.readCurrent(id);
    if (session.kind === 'firebase') {
      if (!this.firebase)
        throw new ApplicationError('FIREBASE_UNAVAILABLE', 503);
      await this.firebase.assertCurrent(
        session.identityKey,
        session.authenticatedAt,
      );
      session = await this.readCurrent(id);
    }
    return this.principal(session);
  }
  async verify(proof: AccessProof): Promise<Principal> {
    const now = this.now();
    if (proof.kind === 'local' && this.profile === 'local' && this.access) {
      if (proof.accessToken.length > 16384)
        throw new ApplicationError('INVALID_ACCESS_TOKEN', 401);
      const token = await this.access.verify(proof.accessToken, now);
      const principal = await this.current(token.sessionId);
      if (
        token.accountId !== principal.accountId ||
        token.installationId !== principal.installationId
      )
        throw new ApplicationError('INVALID_ACCESS_TOKEN', 401);
      return {
        ...principal,
        expiresAt: Math.min(principal.expiresAt, token.expiresAt),
      };
    }
    if (
      proof.kind === 'firebase' &&
      this.profile === 'firebase' &&
      this.firebase
    ) {
      if (
        proof.idToken.length > 16384 ||
        !/^[A-Za-z0-9_-]{43}$/u.test(proof.sessionSecret)
      )
        throw new ApplicationError('UNAUTHENTICATED', 401);
      const token = await this.firebase.verify(proof.idToken);
      if (!this.methods.includes(token.method))
        throw new ApplicationError('PROVIDER_DISALLOWED', 403);
      return this.tx.run(async (ctx) => {
        const session = await this.sessions.findBySecret(
          secretHash(proof.sessionSecret),
          ctx,
        );
        if (
          !session ||
          session.kind !== 'firebase' ||
          session.identityKey !==
            'firebase:' + token.projectId + ':' + token.uid ||
          token.authenticatedAt < session.authenticatedAt
        )
          throw new ApplicationError('UNAUTHENTICATED', 401);
        checkSession(
          session,
          await this.accounts.findById(session.accountId, { context: ctx }),
          await this.installations.findById(session.installationId, {
            context: ctx,
          }),
          now,
        );
        if (!this.methods.includes(session.method))
          throw new ApplicationError('PROVIDER_DISALLOWED', 403);
        return {
          ...this.principal(session),
          expiresAt: Math.min(session.expiresAt, token.expiresAt),
        };
      });
    }
    throw new ApplicationError('AUTH_PROFILE_MISMATCH', 401);
  }
}

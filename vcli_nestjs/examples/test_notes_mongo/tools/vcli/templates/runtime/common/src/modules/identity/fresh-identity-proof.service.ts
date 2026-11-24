import { Injectable } from '@nestjs/common';
import type {
  Transactions,
  TransactionContext,
} from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import type { AccountService } from '../accounts/account.service.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from '../sessions/session.service.js';
import type { IdentityService } from './identity.service.js';
import type { Passwords, FirebaseVerifier } from './credential-ports.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { lockSelfActor } from './identity-self-policy.js';
export type SelfProof = Readonly<{ password?: string; idToken?: string }>;
export type FreshProof = Readonly<{
  identityKey: string;
  credentialVersion: number;
  generation: number;
  authenticatedAt: number;
}>;
@Injectable()
export class FreshIdentityProof {
  constructor(
    private readonly tx: Transactions,
    private readonly accounts: AccountService,
    private readonly identities: IdentityService,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
    private readonly passwords: Passwords | null,
    private readonly firebase: FirebaseVerifier | null,
    private readonly methods: readonly string[],
    private readonly recentAuthMs: number,
  ) {}
  async verify(
    actor: Principal,
    input: SelfProof,
    now: number,
  ): Promise<FreshProof> {
    const original = await this.tx.run(async (ctx) => {
      const session = await lockSelfActor(
        actor,
        now,
        ctx,
        this.accounts,
        this.installations,
        this.sessions,
      );
      const identity = await this.identities.find(session.identityKey, ctx);
      if (!identity?.active) throw new ApplicationError('UNAUTHENTICATED', 401);
      return { session, identity };
    });
    let authenticatedAt = now;
    if (original.session.kind === 'local') {
      if (
        !this.passwords ||
        !input.password ||
        input.idToken ||
        !original.identity.passwordHash ||
        !(await this.passwords.verify(
          original.identity.passwordHash,
          input.password,
        ))
      )
        throw new ApplicationError('INVALID_CREDENTIALS', 401);
    } else {
      if (!this.firebase || !input.idToken || input.password)
        throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
      const proof = await this.firebase.verify(input.idToken);
      if (
        'firebase:' + proof.projectId + ':' + proof.uid !==
          original.identity.key ||
        !this.methods.includes(proof.method) ||
        proof.expiresAt <= now
      )
        throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
      authenticatedAt = proof.authenticatedAt;
      if (
        authenticatedAt > now ||
        now - authenticatedAt > this.recentAuthMs ||
        authenticatedAt <= original.identity.enrollmentCutoff
      )
        throw new ApplicationError('RECENT_AUTH_REQUIRED', 403);
    }
    return {
      identityKey: original.identity.key,
      credentialVersion: original.identity.credentialVersion,
      generation: original.identity.generation,
      authenticatedAt,
    };
  }
  async assertCurrent(
    actor: Principal,
    proof: FreshProof,
    now: number,
    ctx: TransactionContext,
  ): Promise<void> {
    const session = await lockSelfActor(
      actor,
      now,
      ctx,
      this.accounts,
      this.installations,
      this.sessions,
    );
    const identity = await this.identities.find(proof.identityKey, ctx);
    if (
      session.identityKey !== proof.identityKey ||
      !identity?.active ||
      identity.generation !== proof.generation ||
      identity.credentialVersion !== proof.credentialVersion ||
      (session.kind === 'firebase' &&
        proof.authenticatedAt <= identity.enrollmentCutoff) ||
      proof.authenticatedAt > now ||
      now - proof.authenticatedAt > this.recentAuthMs
    )
      throw new ApplicationError('REAUTHENTICATION_REQUIRED', 401);
  }
}

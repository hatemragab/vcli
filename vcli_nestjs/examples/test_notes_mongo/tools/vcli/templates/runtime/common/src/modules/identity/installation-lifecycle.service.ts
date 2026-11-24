import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { Principal } from '../../core/auth/principal.js';
import type { InstallationService } from '../installations/installation.service.js';
import type { SessionService } from '../sessions/session.service.js';
import type {
  FreshIdentityProof,
  SelfProof,
} from './fresh-identity-proof.service.js';
import { capabilityHash } from './secret-facts.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class InstallationLifecycle {
  constructor(
    private readonly tx: Transactions,
    private readonly installations: InstallationService,
    private readonly sessions: SessionService,
    private readonly fresh: FreshIdentityProof,
  ) {}
  async rotate(
    actor: Principal,
    input: SelfProof,
    oldCapability: string,
    newCapability: string,
    now: number,
  ) {
    const proof = await this.fresh.verify(actor, input, now);
    const oldHash = capabilityHash(oldCapability, 'installation-capability'),
      newHash = capabilityHash(newCapability, 'installation-capability');
    if (oldHash === newHash)
      throw new ApplicationError(
        'INSTALLATION_ROTATION_REQUIRES_NEW_CAPABILITY',
        400,
      );
    const installationGeneration = await this.tx.run(async (ctx) => {
      await this.fresh.assertCurrent(actor, proof, now, ctx);
      const generation = await this.installations.rotateCapability(
        actor.installationId,
        actor.accountId,
        oldHash,
        newHash,
        ctx,
      );
      await this.sessions.revokeInstallation(
        actor.installationId,
        generation,
        now,
        ctx,
      );
      return generation;
    });
    return {
      installationId: actor.installationId,
      installationGeneration,
      reauthenticate: true,
    };
  }
}

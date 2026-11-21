import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { ActionDeliveryWriter } from '../../core/mail/action-delivery.js';
import type { Principal } from '../../core/auth/principal.js';
import type { FirebaseActionLinksService } from '../mail/firebase-action-links.service.js';
import { publicEmailActionResponse } from '../mail/firebase-action-policy.js';
import type { FreshIdentityProof } from './fresh-identity-proof.service.js';
import type { FirebaseVerifier } from './credential-ports.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { newId } from './secret-facts.js';
/** Application-delivered Firebase links; local credential/action endpoints are never involved. */
@Injectable()
export class FirebaseActions {
  constructor(
    private readonly tx: Transactions,
    private readonly fresh: FreshIdentityProof,
    private readonly verifier: FirebaseVerifier,
    private readonly links: Pick<FirebaseActionLinksService, 'prepare'>,
    private readonly delivery: ActionDeliveryWriter,
    private readonly continueUrl: string,
    private readonly deliveryLifetimeMs = 900000,
  ) {}
  async verification(actor: Principal, idToken: string, now: number) {
    const fresh = await this.fresh.verify(actor, { idToken }, now),
      proof = await this.verifier.verify(idToken);
    if ('firebase:' + proof.projectId + ':' + proof.uid !== fresh.identityKey)
      throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
    if (!proof.email || proof.emailVerified) return publicEmailActionResponse();
    const prepared = await this.links.prepare({
      operationId: newId(),
      to: proof.email,
      purpose: 'verification',
      continueUrl: this.continueUrl,
    });
    if (prepared.status !== 'prepared') return publicEmailActionResponse();
    const intent = this.delivery.prepare(
      prepared.message,
      now + Math.min(900000, this.deliveryLifetimeMs),
    );
    await this.tx.run(async (ctx) => {
      await this.fresh.assertCurrent(actor, fresh, now, ctx);
      await this.delivery.stage(intent, ctx);
    });
    return publicEmailActionResponse();
  }
  async reset(email: string, now: number) {
    const prepared = await this.links.prepare({
      operationId: newId(),
      to: email,
      purpose: 'password-reset',
      continueUrl: this.continueUrl,
    });
    if (prepared.status === 'prepared') {
      const intent = this.delivery.prepare(
        prepared.message,
        now + Math.min(900000, this.deliveryLifetimeMs),
      );
      await this.tx.run((ctx) => this.delivery.stage(intent, ctx));
    } else await this.tx.run(async () => undefined); // The same DB availability boundary applies to suppressed targets.
    return publicEmailActionResponse();
  }
}

import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import {
  destinationProjection,
  type DestinationResult,
  type PushDestination,
  type PushMessage,
  type PushPurpose,
  type PushEnvironment,
  type PurposeRoutes,
  type PushSenders,
  type PushOutcome,
} from './push.entity.js';
import type { PushRepository } from './push.repository.js';
import type { TrustedCallInvitationPolicy } from './trusted-call-invitation-policy.js';
import { pushRegistration, validatePushMessage } from './push-validation.js';
export type PushRuntimeOptions = Readonly<{
  environment?: PushEnvironment;
  voipPolicy?: TrustedCallInvitationPolicy;
  clock?: () => number;
}>;
@Injectable()
export class PushService {
  private active = 0;
  private readonly environment: PushEnvironment;
  private readonly clock: () => number;
  constructor(
    private readonly destinations: PushRepository,
    private readonly senders: PushSenders,
    private readonly eligibility: Pick<PrincipalAuthority, 'current'>,
    private readonly wait: (milliseconds: number) => Promise<number>,
    private readonly routes: PurposeRoutes,
    private readonly scope: string,
    private readonly options: PushRuntimeOptions = {},
  ) {
    this.environment = options.environment ?? 'sandbox';
    this.clock = options.clock ?? Date.now;
    if (
      !scope ||
      scope.length > 4096 ||
      (routes.voip && routes.voip !== 'apns') ||
      (routes.background && routes.background !== 'apns')
    )
      throw new ApplicationError('INVALID_PUSH_ROUTES', 500);
  }
  async register(
    principal: Principal,
    input: Readonly<{
      id?: string;
      generation?: string;
      token: string;
      tokenHash?: string;
      scope?: string;
      purpose: PushPurpose;
      platform: 'android' | 'ios' | 'web';
      now: number;
    }>,
  ): Promise<ReturnType<typeof destinationProjection>> {
    if (
      !Number.isSafeInteger(input.now) ||
      input.now < 0 ||
      !pushRegistration.safeParse({
        purpose: input.purpose,
        platform: input.platform,
        token: input.token,
      }).success ||
      (input.scope !== undefined && input.scope !== this.scope)
    )
      throw new ApplicationError('INVALID_PUSH_DESTINATION', 400);
    const provider = this.routes[input.purpose];
    if (!provider)
      throw new ApplicationError('PUSH_PROVIDER_NOT_CONFIGURED', 503);
    if (
      provider === 'apns' &&
      (input.platform !== 'ios' ||
        !/^(?:[0-9a-f]{2}){32,256}$/.test(input.token))
    )
      throw new ApplicationError('INVALID_APNS_DESTINATION', 400);
    await this.authorize(principal, Math.max(input.now, this.clock()));
    // Caller identifiers/hashes cannot establish ownership or choose generation.
    const destination: PushDestination = {
      id: randomUUID(),
      generation: randomUUID(),
      tokenHash: createHash('sha256').update(input.token).digest('hex'),
      accountId: principal.accountId,
      sessionId: principal.sessionId,
      installationId: principal.installationId,
      installationGeneration: principal.installationGeneration,
      scope: this.scope,
      environment: this.environment,
      provider,
      purpose: input.purpose,
      platform: input.platform,
      token: input.token,
      updatedAt: Math.max(input.now, this.clock()),
    };
    const registered = await this.destinations.register(destination);
    // Rebind during the owner write may leave only an old-generation fenced row.
    await this.authorize(principal, this.clock());
    return destinationProjection(registered);
  }
  async list(
    principal: Principal,
  ): Promise<readonly ReturnType<typeof destinationProjection>[]> {
    await this.authorize(principal, this.clock());
    const entries = await this.destinations.list(
      principal.accountId,
      principal.installationId,
      undefined,
      principal.installationGeneration,
      this.scope,
      this.environment,
    );
    await this.authorize(principal, this.clock());
    return entries.map(destinationProjection);
  }
  async remove(
    principal: Principal,
    id: string,
    generation: string,
  ): Promise<boolean> {
    await this.authorize(principal, this.clock());
    const entries = await this.destinations.list(
      principal.accountId,
      principal.installationId,
      undefined,
      principal.installationGeneration,
      this.scope,
      this.environment,
    );
    const destination = entries.find(
      (entry) => entry.id === id && entry.generation === generation,
    );
    const removed = destination
      ? await this.destinations.removeExact(destination)
      : false;
    await this.authorize(principal, this.clock());
    return removed;
  }
  async notifySelf(
    principal: Principal,
    message: PushMessage,
    now: number,
  ): Promise<readonly DestinationResult[]> {
    await this.authorize(principal, Math.max(now, this.clock()));
    if (message.purpose === 'voip')
      throw new ApplicationError('VOIP_REQUIRES_AUTHORIZED_CALL', 403);
    return this.notify(
      principal.accountId,
      message,
      now,
      principal.installationId,
      principal,
    );
  }
  notifyAccount(
    accountId: string,
    message: PushMessage,
    now: number,
    installationId?: string,
  ): Promise<readonly DestinationResult[]> {
    return this.notify(accountId, message, now, installationId);
  }
  notifyInstallation(
    accountId: string,
    installationId: string,
    message: PushMessage,
    now: number,
  ): Promise<readonly DestinationResult[]> {
    return this.notify(accountId, message, now, installationId);
  }
  private async notify(
    accountId: string,
    message: PushMessage,
    now: number,
    installationId?: string,
    actor?: Principal,
  ): Promise<readonly DestinationResult[]> {
    // Copy validated payload before any await so application mutation cannot change a policy decision.
    message = structuredClone(message);
    now = Math.max(Number.isFinite(now) ? now : this.clock(), this.clock());
    validatePushMessage(message, now);
    if (!this.routes[message.purpose])
      throw new ApplicationError('PUSH_PROVIDER_NOT_CONFIGURED', 503);
    if (message.purpose === 'voip' && !this.options.voipPolicy)
      throw new ApplicationError('VOIP_POLICY_NOT_CONFIGURED', 503);
    if (this.active >= 4) throw new ApplicationError('PUSH_BUSY', 503);
    this.active += 1;
    try {
      const snapshot = await this.destinations.list(
        accountId,
        installationId,
        message.purpose,
        actor?.installationGeneration,
        this.scope,
        this.environment,
      );
      const results: DestinationResult[] = [];
      // Serial per operation, at most four operations globally; account destinations capped at 32.
      for (const destination of snapshot.slice(0, 32))
        results.push(await this.deliver(destination, message, now, actor));
      return results;
    } finally {
      this.active -= 1;
    }
  }
  private async deliver(
    destination: PushDestination,
    message: PushMessage,
    initialNow: number,
    actor?: Principal,
  ): Promise<DestinationResult> {
    let now = Math.max(initialNow, this.clock());
    const result = (outcome: PushOutcome): DestinationResult => ({
      destinationId: destination.id,
      generation: destination.generation,
      installationGeneration: destination.installationGeneration,
      outcome,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      now = Math.max(now, this.clock());
      if (now >= message.expiresAt)
        return result({
          status: 'rejected',
          code: 'PUSH_EXPIRED',
          invalidDestination: false,
        });
      if (message.purpose === 'voip') {
        let allowed = false;
        try {
          allowed = await this.options.voipPolicy!.authorize({
            accountId: destination.accountId,
            installationId: destination.installationId,
            installationGeneration: destination.installationGeneration,
            callId: message.data.callId!,
            operationId: message.operationId,
            expiresAt: message.expiresAt,
            now,
          });
        } catch {
          /* Fail closed. */
        }
        if (!allowed)
          return result({
            status: 'rejected',
            code: 'VOIP_CALL_NOT_AUTHORIZED',
            invalidDestination: false,
          });
      }
      if (actor) {
        try {
          await this.authorize(actor, this.clock());
        } catch {
          return result({
            status: 'rejected',
            code: 'PUSH_DESTINATION_INELIGIBLE',
            invalidDestination: false,
          });
        }
      }
      // The last asynchronous boundary before provider disclosure is current authority.
      if (!(await this.eligible(destination, Math.max(now, this.clock()))))
        return result({
          status: 'rejected',
          code: 'PUSH_DESTINATION_INELIGIBLE',
          invalidDestination: false,
        });
      now = Math.max(now, this.clock());
      if (now >= message.expiresAt)
        return result({
          status: 'rejected',
          code: 'PUSH_EXPIRED',
          invalidDestination: false,
        });
      const sender = this.senders[destination.provider];
      let outcome: PushOutcome;
      try {
        outcome = sender
          ? await sender.submit(destination, message, now, async () => {
              if (this.clock() >= message.expiresAt) return false;
              if (actor) {
                try {
                  await this.authorize(actor, this.clock());
                } catch {
                  return false;
                }
              }
              if (message.purpose === 'voip') {
                try {
                  if (
                    !(await this.options.voipPolicy!.authorize({
                      accountId: destination.accountId,
                      installationId: destination.installationId,
                      installationGeneration:
                        destination.installationGeneration,
                      callId: message.data.callId!,
                      operationId: message.operationId,
                      expiresAt: message.expiresAt,
                      now: this.clock(),
                    }))
                  )
                    return false;
                } catch {
                  return false;
                }
              }
              return (
                (await this.eligible(destination, this.clock())) &&
                this.clock() < message.expiresAt
              );
            })
          : {
              status: 'rejected',
              code: 'PUSH_PROVIDER_NOT_CONFIGURED',
              invalidDestination: false,
            };
      } catch {
        outcome = { status: 'unknown', code: 'PUSH_ACCEPTANCE_UNKNOWN' };
      }
      if (
        outcome.status === 'rejected' &&
        outcome.invalidDestination &&
        (await this.eligible(destination, this.clock()))
      )
        await this.destinations.removeExact(destination);
      if (outcome.status !== 'unavailable' || attempt === 2)
        return result(outcome);
      // This immediate dispatcher never holds a request for a long provider backoff.
      const retry = Math.max(outcome.retryAfterMs, 1000 * 2 ** attempt);
      if (
        !Number.isFinite(retry) ||
        retry > 2000 ||
        Math.max(now, this.clock()) + retry >= message.expiresAt
      )
        return result(outcome);
      now = Math.max(now, await this.wait(retry));
    }
    throw new ApplicationError('PUSH_RETRY_POLICY_FAILURE', 500);
  }
  private async authorize(principal: Principal, now: number): Promise<void> {
    const current = await this.eligibility.current(principal.sessionId);
    if (
      current.sessionId !== principal.sessionId ||
      current.accountId !== principal.accountId ||
      current.installationId !== principal.installationId ||
      current.installationGeneration !== principal.installationGeneration ||
      !Number.isSafeInteger(principal.installationGeneration) ||
      principal.installationGeneration < 1 ||
      current.expiresAt <= now ||
      principal.expiresAt <= now
    )
      throw new ApplicationError('UNAUTHENTICATED', 401);
  }
  private async eligible(
    destination: PushDestination,
    now: number,
  ): Promise<boolean> {
    if (
      destination.installationGeneration < 1 ||
      destination.scope !== this.scope ||
      destination.environment !== this.environment ||
      destination.provider !== this.routes[destination.purpose] ||
      !(await this.destinations.current(destination))
    )
      return false;
    try {
      const current = await this.eligibility.current(destination.sessionId);
      return (
        current.sessionId === destination.sessionId &&
        current.accountId === destination.accountId &&
        current.installationId === destination.installationId &&
        current.installationGeneration === destination.installationGeneration &&
        current.expiresAt > Math.max(now, this.clock())
      );
    } catch {
      return false;
    }
  }
}

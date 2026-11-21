import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type {
  DestinationResult,
  PushDestination,
  PushMessage,
  PushPurpose,
  PurposeRoutes,
} from './push.entity.js';
import type { PushRepository } from './push.repository.js';
import type { PushSenders, PushOutcome } from './push.entity.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
@Injectable()
export class PushService {
  private active = 0;
  constructor(
    private readonly destinations: PushRepository,
    private readonly senders: PushSenders,
    private readonly eligibility: Pick<PrincipalAuthority, 'current'>,
    private readonly wait: (milliseconds: number) => Promise<number>,
    private readonly routes: PurposeRoutes,
    private readonly scope: string,
  ) {}
  async register(
    principal: Principal,
    input: Readonly<{
      id: string;
      generation: string;
      token: string;
      tokenHash: string;
      scope: string;
      purpose: PushPurpose;
      platform: 'android' | 'ios' | 'web';
      now: number;
    }>,
  ): Promise<PushDestination> {
    const provider = this.routes[input.purpose];
    if (!provider)
      throw new ApplicationError('PUSH_PROVIDER_NOT_CONFIGURED', 503);
    if (
      provider === 'apns' &&
      (input.platform !== 'ios' ||
        !/^[0-9a-f]{64,512}$/.test(input.token) ||
        input.token.length % 2 !== 0)
    )
      throw new ApplicationError('INVALID_APNS_DESTINATION', 400);
    const current = await this.eligibility.current(principal.sessionId);
    if (
      current.accountId !== principal.accountId ||
      current.installationId !== principal.installationId ||
      current.expiresAt <= input.now
    )
      throw new ApplicationError('UNAUTHENTICATED', 401);
    const destination: PushDestination = {
      id: input.id,
      generation: input.generation,
      accountId: principal.accountId,
      sessionId: principal.sessionId,
      installationId: principal.installationId,
      scope: input.scope,
      provider,
      purpose: input.purpose,
      platform: input.platform,
      token: input.token,
      tokenHash: input.tokenHash,
      updatedAt: input.now,
    };
    await this.destinations.register(destination);
    return destination;
  }
  list(principal: Principal): Promise<readonly PushDestination[]> {
    return this.destinations.list(
      principal.accountId,
      principal.installationId,
    );
  }
  remove(
    principal: Principal,
    id: string,
    generation: string,
  ): Promise<boolean> {
    return this.destinations.remove(
      principal.accountId,
      principal.installationId,
      id,
      generation,
    );
  }
  async notifyAccount(
    accountId: string,
    message: PushMessage,
    now: number,
    installationId?: string,
  ): Promise<readonly DestinationResult[]> {
    if (!this.routes[message.purpose])
      throw new ApplicationError('PUSH_PROVIDER_NOT_CONFIGURED', 503);
    if (
      !/^[0-9a-f-]{36}$/.test(message.operationId) ||
      Object.keys(message.data).length > 12 ||
      JSON.stringify(message).length > 3000
    )
      throw new ApplicationError('INVALID_PUSH_MESSAGE', 400);
    if (
      message.purpose === 'voip' &&
      (!message.data.callId || message.title || message.body)
    )
      throw new ApplicationError('VOIP_REQUIRES_CALL_ID', 400);
    if (message.purpose === 'background' && (message.title || message.body))
      throw new ApplicationError('BACKGROUND_PUSH_HAS_ALERT', 400);
    if (message.purpose === 'ordinary' && !message.title && !message.body)
      throw new ApplicationError('ORDINARY_PUSH_REQUIRES_ALERT', 400);
    if (message.expiresAt <= now || message.expiresAt > now + 300000)
      throw new ApplicationError('INVALID_PUSH_EXPIRY', 400);
    if (this.active >= 4) throw new ApplicationError('PUSH_BUSY', 503);
    this.active += 1;
    try {
      const snapshot = await this.destinations.list(
        accountId,
        installationId,
        message.purpose,
      );
      const results: DestinationResult[] = [];
      for (const destination of snapshot.slice(0, 32))
        results.push(await this.deliver(destination, message, now));
      return results;
    } finally {
      this.active -= 1;
    }
  }
  private async deliver(
    destination: PushDestination,
    message: PushMessage,
    initialNow: number,
  ): Promise<DestinationResult> {
    let now = initialNow;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (now >= message.expiresAt || !(await this.eligible(destination, now)))
        return {
          destinationId: destination.id,
          generation: destination.generation,
          outcome: {
            status: 'rejected',
            code: 'PUSH_DESTINATION_INELIGIBLE',
            invalidDestination: false,
          },
        };
      const sender = this.senders[destination.provider];
      const outcome: PushOutcome = sender
        ? await sender.submit(destination, message, now)
        : {
            status: 'rejected',
            code: 'PUSH_PROVIDER_NOT_CONFIGURED',
            invalidDestination: false,
          };
      if (outcome.status === 'rejected' && outcome.invalidDestination)
        await this.destinations.remove(
          destination.accountId,
          destination.installationId,
          destination.id,
          destination.generation,
        );
      if (
        outcome.status !== 'unavailable' ||
        attempt === 2 ||
        outcome.retryAfterMs > 2000
      )
        return {
          destinationId: destination.id,
          generation: destination.generation,
          outcome,
        };
      now = await this.wait(Math.max(outcome.retryAfterMs, 100 * 2 ** attempt));
    }
    throw new ApplicationError('PUSH_RETRY_POLICY_FAILURE', 500);
  }
  private async eligible(
    destination: PushDestination,
    now: number,
  ): Promise<boolean> {
    if (
      destination.scope !== this.scope ||
      destination.provider !== this.routes[destination.purpose]
    )
      return false;
    if (!(await this.destinations.current(destination))) return false;
    try {
      const principal = await this.eligibility.current(destination.sessionId);
      return (
        principal.accountId === destination.accountId &&
        principal.installationId === destination.installationId &&
        principal.expiresAt > now
      );
    } catch {
      return false;
    }
  }
}

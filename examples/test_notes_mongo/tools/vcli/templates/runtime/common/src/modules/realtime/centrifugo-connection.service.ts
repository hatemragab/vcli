import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type {
  ApplicationEvent,
  PublicationOutcome,
} from '../../core/realtime/event-publisher.js';
import type {
  RealtimeBinding,
  RealtimeStore,
} from '../../core/realtime/realtime-store.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { CentrifugoApiService } from './centrifugo-api.service.js';
import { recheckPrincipal, withDeadline } from './protocol-validation.js';
const connectSchema = z.object({
  client: z.uuid(),
  transport: z.literal('websocket'),
  protocol: z.literal('json'),
  encoding: z.literal('json'),
  data: z.strictObject({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
  channels: z.array(z.string().max(128)).max(8).optional(),
});
const refreshSchema = z.object({
  client: z.uuid(),
  user: z.string().regex(/^[a-f0-9]{64}$/),
  transport: z.literal('websocket'),
  protocol: z.literal('json'),
  encoding: z.literal('json'),
});
const denial = { disconnect: { code: 4501, reason: 'unauthorized' } } as const;
const expired = { result: { expired: true } } as const;
const unavailable = {
  error: { code: 100, message: 'internal server error', temporary: true },
} as const;
/** Proxy authority and native shared connection leases work on any API node. */
@Injectable()
export class CentrifugoConnectionService {
  private leaseTimer: ReturnType<typeof setInterval> | undefined;
  private sweeping: Promise<void> | undefined;
  private readonly secretHash: Buffer;
  private pending = 0;
  private closed = false;
  constructor(
    private readonly authority: PrincipalAuthority,
    private readonly tickets: RealtimeTicketService,
    private readonly store: RealtimeStore,
    private readonly api: CentrifugoApiService,
    secret: string,
  ) {
    if (secret.length < 32)
      throw new Error('CENTRIFUGO_PROXY_SECRET_TOO_SHORT');
    this.secretHash = createHash('sha256').update(secret).digest();
  }
  async connect(secret: unknown, input: unknown): Promise<unknown> {
    if (!this.validSecret(secret)) return denial;
    if (this.closed || this.pending >= 16) return unavailable;
    const parsed = connectSchema.safeParse(input);
    if (!parsed.success || (parsed.data.channels?.length ?? 0) > 0)
      return denial;
    this.pending++;
    let binding: RealtimeBinding | undefined;
    try {
      const principal = await this.tickets.consume(
        parsed.data.data.ticket,
        'centrifugo',
      );
      if (this.closed) return unavailable;
      const client = parsed.data.client,
        user = this.user(principal);
      binding = {
        client,
        principal,
        user,
        channel: `private:${this.hash(user + ':' + client)}`,
        expiresAt: Math.min(principal.expiresAt, Date.now() + 10000),
      };
      await this.store.addBinding(binding, Date.now());
      await recheckPrincipal(this.authority, principal);
      if (this.closed) throw new ApplicationError('REALTIME_CLOSED', 503);
      return {
        result: {
          user,
          expire_at: this.expiry(principal),
          subs: { [binding.channel]: {} },
        },
      };
    } catch (error) {
      if (binding) await this.invalidate(binding).catch(() => {});
      return error instanceof ApplicationError &&
        [400, 401, 403].includes(error.status)
        ? denial
        : unavailable;
    } finally {
      this.pending--;
    }
  }
  async refresh(secret: unknown, input: unknown): Promise<unknown> {
    if (!this.validSecret(secret)) return expired;
    if (this.closed || this.pending >= 16)
      throw new ApplicationError('CENTRIFUGO_REFRESH_RETRY', 503);
    const parsed = refreshSchema.safeParse(input);
    if (!parsed.success) return expired;
    this.pending++;
    let binding: RealtimeBinding | null = null;
    try {
      binding = await this.store.binding(parsed.data.client);
      if (
        !binding ||
        binding.user !== parsed.data.user ||
        binding.expiresAt <= Date.now()
      )
        return expired;
      await recheckPrincipal(this.authority, binding.principal);
      if (this.closed)
        throw new ApplicationError('CENTRIFUGO_REFRESH_RETRY', 503);
      if (
        !(await this.store.touchBinding(
          binding,
          Math.min(binding.principal.expiresAt, Date.now() + 10000),
        ))
      )
        return expired;
      return { result: { expire_at: this.expiry(binding.principal) } };
    } catch (error) {
      if (binding) await this.invalidate(binding).catch(() => {});
      if (error instanceof ApplicationError && error.status === 401)
        return expired;
      throw new ApplicationError('CENTRIFUGO_REFRESH_RETRY', 503);
    } finally {
      this.pending--;
    }
  }
  async publish(
    accountId: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome> {
    if (this.closed) return { status: 'unavailable', transport: 'centrifugo' };
    let accepted = 0,
      unknown = false,
      failed = false;
    let entries: readonly RealtimeBinding[];
    try {
      entries = await this.store.bindings(accountId);
    } catch {
      return { status: 'unavailable', transport: 'centrifugo' };
    }
    // Sequential checks keep at most one private provider request in flight per publication.
    for (const binding of entries) {
      try {
        if (binding.expiresAt <= Date.now()) {
          await this.invalidate(binding);
          continue;
        }
        const current = await this.store.binding(binding.client);
        if (
          this.closed ||
          !current ||
          current.user !== binding.user ||
          current.expiresAt <= Date.now()
        )
          continue;
        await recheckPrincipal(this.authority, binding.principal);
        if (this.closed || current.expiresAt <= Date.now()) continue;
        const outcome = await this.api.publish(binding.channel, event);
        if (outcome === 'accepted') accepted++;
        else if (outcome === 'unknown') unknown = true;
        else failed = true;
      } catch {
        failed = true;
        await this.invalidate(binding).catch(() => {});
      }
    }
    return {
      status: unknown
        ? 'unknown'
        : failed
          ? 'unavailable'
          : accepted
            ? 'provider-accepted'
            : 'audience-ineligible',
      transport: 'centrifugo',
    };
  }
  async attach(_server?: unknown): Promise<void> {
    if (this.closed || this.leaseTimer)
      throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');
    this.leaseTimer = setInterval(() => {
      void this.sweep();
    }, 1000);
    this.leaseTimer.unref();
  }
  sweep(): Promise<void> {
    return (this.sweeping ??= (async () => {
      try {
        await Promise.all(
          (await this.store.bindings()).map(async (binding) => {
            if (this.closed) return;
            try {
              if (binding.expiresAt <= Date.now()) throw new Error('EXPIRED');
              await recheckPrincipal(this.authority, binding.principal);
            } catch {
              await this.invalidate(binding).catch(() => {});
            }
          }),
        );
      } catch {
        /* Native authority unavailable: outbound and callbacks also fail closed. */
      }
    })().finally(() => {
      this.sweeping = undefined;
    }));
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.leaseTimer);
    // Shared provider connections belong to Centrifugo, not to this particular API process.
    // Another API node may refresh them; without one, their ten-second shared lease expires.
    this.api.close();
    if (this.sweeping) await withDeadline(this.sweeping, 3000).catch(() => {});
  }
  private async invalidate(binding: RealtimeBinding): Promise<void> {
    if (await this.store.removeBinding(binding))
      await this.api.disconnect(binding.user, binding.client);
  }
  private user(principal: Principal): string {
    return this.hash(
      JSON.stringify([
        principal.accountId,
        principal.sessionId,
        principal.installationId,
        principal.installationGeneration,
      ]),
    );
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
  private expiry(principal: Principal): number {
    return Math.floor(Math.min(principal.expiresAt, Date.now() + 5000) / 1000);
  }
  private validSecret(input: unknown): boolean {
    return (
      typeof input === 'string' &&
      input.length <= 512 &&
      timingSafeEqual(
        this.secretHash,
        createHash('sha256').update(input).digest(),
      )
    );
  }
}

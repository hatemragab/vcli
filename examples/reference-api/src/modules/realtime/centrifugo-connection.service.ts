import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { RealtimeService } from './realtime.service.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';
import { CentrifugoApiService } from './centrifugo-api.service.js';
import { recheckPrincipal } from './protocol-validation.js';
const connectSchema = z.object({
  client: z.uuid(),
  transport: z.literal('websocket'),
  protocol: z.literal('json'),
  encoding: z.literal('json'),
  data: z.strictObject({ ticket: z.string().length(43) }),
  channels: z.array(z.string().max(128)).max(8).optional(),
});
const refreshSchema = z.object({
  client: z.uuid(),
  user: z.string().min(1).max(128),
  transport: z.literal('websocket'),
  protocol: z.literal('json'),
  encoding: z.literal('json'),
});
const denial = { disconnect: { code: 4501, reason: 'unauthorized' } } as const;
const unavailable = {
  error: { code: 100, message: 'internal server error' },
} as const;
@Injectable()
export class CentrifugoConnectionService {
  private readonly connections = new Map<
    string,
    {
      principal: Principal;
      refreshedAt: number;
    }
  >();
  private leaseTimer: ReturnType<typeof setInterval> | undefined;
  private readonly secretHash: Buffer;
  private pending = 0;
  private closed = false;
  constructor(
    private readonly authority: PrincipalAuthority,
    private readonly tickets: RealtimeTicketService,
    private readonly registry: RealtimeService,
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
    if (!parsed.success || this.connections.has(parsed.data.client))
      return denial;
    this.pending++;
    try {
      const principal = await this.tickets.consume(
        parsed.data.data.ticket,
        'centrifugo',
      );
      const client = parsed.data.client;
      if (this.closed) return unavailable;
      const channel = this.channel(client);
      this.registry.add({
        id: client,
        principal,
        send: (event) => this.api.publish(channel, event),
        close: () => {
          this.connections.delete(client);
          void this.api.disconnect(principal.accountId, client);
        },
      });
      this.connections.set(client, { principal, refreshedAt: Date.now() });
      return {
        result: {
          user: principal.accountId,
          expire_at: this.expiry(principal),
          subs: { [channel]: {} },
        },
      };
    } catch (error) {
      return error instanceof ApplicationError && error.status === 503
        ? unavailable
        : denial;
    } finally {
      this.pending--;
    }
  }
  async refresh(secret: unknown, input: unknown): Promise<unknown> {
    if (!this.validSecret(secret) || this.closed)
      return { result: { expired: true } };
    const parsed = refreshSchema.safeParse(input);
    if (!parsed.success || this.pending >= 16)
      return { result: { expired: true } };
    const binding = this.connections.get(parsed.data.client);
    const principal = binding?.principal;
    if (!binding || !principal || principal.accountId !== parsed.data.user)
      return { result: { expired: true } };
    this.pending++;
    try {
      await recheckPrincipal(this.authority, principal);
      if (this.connections.get(parsed.data.client) !== binding)
        return { result: { expired: true } };
      binding.refreshedAt = Date.now();
      return { result: { expire_at: this.expiry(principal) } };
    } catch {
      return { result: { expired: true } };
    } finally {
      this.pending--;
    }
  }
  async attach(_server?: unknown): Promise<void> {
    if (this.closed || this.leaseTimer)
      throw new Error('REALTIME_ALREADY_ATTACHED_OR_CLOSED');
    this.leaseTimer = setInterval(() => {
      for (const [client, binding] of this.connections)
        if (Date.now() - binding.refreshedAt > 15000) {
          this.registry.remove(client);
          this.connections.delete(client);
          void this.api.disconnect(binding.principal.accountId, client);
        }
    }, 1000);
    this.leaseTimer.unref();
  }
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.leaseTimer);
    this.connections.clear();
    this.api.close();
  }
  private channel(client: string): string {
    return `private:${createHash('sha256').update(client).digest('hex')}`;
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

import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { recheckPrincipal } from './protocol-validation.js';
type Ticket = Readonly<{
  principal: Principal;
  purpose: 'ws' | 'centrifugo';
  expiresAt: number;
}>;
/** Single-process atomic one-use admission; only credential hashes are retained. */
@Injectable()
export class RealtimeTicketService {
  private readonly tickets = new Map<string, Ticket>();
  private readonly rates = new Map<
    string,
    {
      startedAt: number;
      count: number;
    }
  >();
  private pending = 0;
  private closed = false;
  constructor(
    private readonly authority: PrincipalAuthority,
    private readonly ttlSeconds: number,
  ) {}
  async issue(
    principal: Principal,
    purpose: Ticket['purpose'],
  ): Promise<{
    ticket: string;
    expiresAt: number;
  }> {
    if (this.closed || this.pending >= 16)
      throw new ApplicationError('REALTIME_LIMIT', 429);
    this.pending++;
    try {
      const current = await recheckPrincipal(this.authority, principal);
      const now = Date.now();
      if (this.closed) throw new ApplicationError('REALTIME_LIMIT', 429);
      for (const [key, rate] of this.rates)
        if (now - rate.startedAt >= 60000) this.rates.delete(key);
      const rate = this.rates.get(current.sessionId);
      if ((rate?.count ?? 0) >= 10 || (!rate && this.rates.size >= 512))
        throw new ApplicationError('REALTIME_LIMIT', 429);
      for (const [key, entry] of this.tickets)
        if (entry.expiresAt <= now) this.tickets.delete(key);
      if (
        this.tickets.size >= 512 ||
        [...this.tickets.values()].filter(
          (entry) => entry.principal.sessionId === current.sessionId,
        ).length >= 4
      )
        throw new ApplicationError('REALTIME_LIMIT', 429);
      const ticket = randomBytes(32).toString('base64url');
      const expiresAt = Math.min(
        now + Math.min(this.ttlSeconds, 30) * 1000,
        current.expiresAt,
      );
      this.tickets.set(this.hash(ticket), {
        principal: current,
        purpose,
        expiresAt,
      });
      this.rates.set(current.sessionId, {
        startedAt: rate?.startedAt ?? now,
        count: (rate?.count ?? 0) + 1,
      });
      return { ticket, expiresAt };
    } finally {
      this.pending--;
    }
  }
  async consume(
    ticket: string,
    purpose: Ticket['purpose'],
  ): Promise<Principal> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket))
      throw new ApplicationError('INVALID_REALTIME_TICKET', 401);
    const key = this.hash(ticket);
    const record = this.tickets.get(key);
    this.tickets.delete(key); // No await before deletion: competing consumers cannot both admit.
    if (!record || record.purpose !== purpose || record.expiresAt <= Date.now())
      throw new ApplicationError('INVALID_REALTIME_TICKET', 401);
    return recheckPrincipal(this.authority, record.principal);
  }
  close(): void {
    this.closed = true;
    this.tickets.clear();
    this.rates.clear();
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

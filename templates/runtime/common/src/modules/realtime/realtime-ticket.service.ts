import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type {
  RealtimeStore,
  TicketPurpose,
} from '../../core/realtime/realtime-store.js';
import { recheckPrincipal } from './protocol-validation.js';
/** Durable native atomic one-use admission, shared across API processes. */
@Injectable()
export class RealtimeTicketService {
  private pending = 0;
  private closed = false;
  constructor(
    private readonly authority: PrincipalAuthority,
    private readonly ttlSeconds: number,
    private readonly store: RealtimeStore,
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 30)
      throw new Error('INVALID_REALTIME_TICKET_TTL');
  }
  async issue(
    principal: Principal,
    purpose: TicketPurpose,
  ): Promise<{ ticket: string; expiresAt: number }> {
    if (this.closed || this.pending >= 16)
      throw new ApplicationError('REALTIME_LIMIT', 429);
    this.pending++;
    try {
      const current = await recheckPrincipal(this.authority, principal);
      if (this.closed) throw new ApplicationError('REALTIME_CLOSED', 503);
      const now = Date.now(),
        ticket = randomBytes(32).toString('base64url');
      const expiresAt = Math.min(
        now + this.ttlSeconds * 1000,
        current.expiresAt,
      );
      await this.store.issue(
        { hash: this.hash(ticket), principal: current, purpose, expiresAt },
        now,
      );
      if (this.closed) throw new ApplicationError('REALTIME_CLOSED', 503);
      return { ticket, expiresAt };
    } finally {
      this.pending--;
    }
  }
  async consume(ticket: string, purpose: TicketPurpose): Promise<Principal> {
    if (this.closed || this.pending >= 16)
      throw new ApplicationError('REALTIME_LIMIT', 429);
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket))
      throw new ApplicationError('INVALID_REALTIME_TICKET', 401);
    this.pending++;
    try {
      const principal = await this.store.consume(
        this.hash(ticket),
        purpose,
        Date.now(),
      );
      if (!principal || this.closed)
        throw new ApplicationError('INVALID_REALTIME_TICKET', 401);
      return await recheckPrincipal(this.authority, principal);
    } finally {
      this.pending--;
    }
  }
  close(): void {
    this.closed = true;
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

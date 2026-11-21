import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import type {
  ApplicationEvent,
  EventPublisher,
  PublicationOutcome,
} from '../../core/realtime/event-publisher.js';
import type { DiagnosticEvents } from '../../core/diagnostics/diagnostic-events.js';
import {
  accountEventSchema,
  limits,
  recheckPrincipal,
} from './protocol-validation.js';
export type Connection = Readonly<{
  id: string;
  principal: Principal;
  send(event: ApplicationEvent): boolean | Promise<boolean>;
  close(): void;
}>;
/** Protocol-neutral connection references; socket objects remain in their protocol services. */
@Injectable()
export class RealtimeService implements EventPublisher {
  private readonly entries = new Map<string, Connection>();
  private readonly checking = new Set<string>();
  private readonly timer: ReturnType<typeof setInterval>;
  private publishing = 0;
  private closed = false;
  private remote:
    | ((
        accountId: string,
        event: ApplicationEvent,
      ) => Promise<PublicationOutcome>)
    | undefined;
  setPublisher(
    publish: (
      accountId: string,
      event: ApplicationEvent,
    ) => Promise<PublicationOutcome>,
  ): void {
    if (this.remote || this.closed)
      throw new Error('REALTIME_PUBLISHER_ALREADY_CONFIGURED');
    this.remote = publish;
  }
  constructor(
    private readonly authority: PrincipalAuthority,
    private readonly diagnostics: DiagnosticEvents,
    private readonly transport: PublicationOutcome['transport'],
    private readonly maxPayloadBytes = 16384,
  ) {
    this.timer = setInterval(() => {
      void this.sweep();
    }, limits.recheckMs);
    this.timer.unref();
  }
  add(connection: Connection): void {
    if (
      this.closed ||
      this.entries.has(connection.id) ||
      this.entries.size >= limits.connections ||
      [...this.entries.values()].filter(
        (entry) => entry.principal.sessionId === connection.principal.sessionId,
      ).length >= limits.perSession
    )
      throw new ApplicationError('REALTIME_LIMIT', 429);
    if (connection.principal.expiresAt <= Date.now())
      throw new ApplicationError('UNAUTHENTICATED', 401);
    this.entries.set(connection.id, connection);
    this.diagnostics.record({ event: 'realtime.admitted', severity: 'info' });
  }
  remove(id: string): void {
    this.entries.delete(id);
  }
  count(): number {
    return this.entries.size;
  }
  async publish(
    accountId: string,
    input: ApplicationEvent,
  ): Promise<PublicationOutcome> {
    const event = accountEventSchema.parse(input);
    if (
      Buffer.byteLength(JSON.stringify(event)) > this.maxPayloadBytes ||
      this.closed ||
      this.publishing >= limits.concurrentPublishes
    )
      return { status: 'unavailable', transport: this.transport };
    this.publishing++;
    try {
      return this.remote
        ? await this.remote(accountId, event)
        : await this.publishLocal(accountId, event);
    } finally {
      this.publishing--;
    }
  }
  async publishLocal(
    accountId: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome> {
    event = accountEventSchema.parse(event);
    if (
      this.closed ||
      Buffer.byteLength(JSON.stringify(event)) > this.maxPayloadBytes
    )
      return { status: 'unavailable', transport: this.transport };
    let attempted = 0;
    let dropped = 0;
    let authorityUnavailable = false;
    const eligible = [...this.entries.values()].filter(
      (entry) => entry.principal.accountId === accountId,
    );
    await Promise.all(
      eligible.map(async (entry) => {
        try {
          await recheckPrincipal(this.authority, entry.principal);
        } catch (error) {
          if (!(error instanceof ApplicationError) || error.status !== 401)
            authorityUnavailable = true;
          this.invalidate(entry);
          return;
        }
        if (this.closed || this.entries.get(entry.id) !== entry) return;
        try {
          if (await entry.send(event)) attempted++;
          else {
            dropped++;
            this.invalidate(entry);
          }
        } catch {
          dropped++;
          this.invalidate(entry);
        }
      }),
    );
    if (dropped)
      this.diagnostics.record({
        event: 'realtime.dropped',
        severity: 'warn',
        count: dropped,
      });
    return {
      status: authorityUnavailable
        ? 'unavailable'
        : attempted
          ? this.transport === 'centrifugo'
            ? 'provider-accepted'
            : 'attempted'
          : dropped
            ? 'unavailable'
            : 'audience-ineligible',
      transport: this.transport,
    };
  }
  async sweep(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        if (this.checking.has(entry.id)) return;
        this.checking.add(entry.id);
        try {
          await recheckPrincipal(this.authority, entry.principal);
        } catch {
          this.invalidate(entry);
        } finally {
          this.checking.delete(entry.id);
        }
      }),
    );
  }
  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    for (const entry of [...this.entries.values()]) this.invalidate(entry);
  }
  private invalidate(entry: Connection): void {
    if (this.entries.get(entry.id) !== entry) return;
    this.entries.delete(entry.id);
    entry.close();
  }
}

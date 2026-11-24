import type {
  AdmissionTicket,
  RealtimeBinding,
  RealtimeStore,
  TicketPurpose,
} from '../templates/runtime/common/src/core/realtime/realtime-store.js';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
/** Controlled persistence fake, only for protocol tests. Native atomicity is a separate opt-in gate. */
export class ControlledRealtimeStore implements RealtimeStore {
  readonly tickets = new Map<string, AdmissionTicket>();
  readonly connections = new Map<string, RealtimeBinding>();
  readonly nodeLeases = new Map<string, number>();
  readonly rates = new Map<string, { expiresAt: number; count: number }>();
  fail = false;
  async assertInitialized(): Promise<void> {
    this.check();
  }
  async issue(ticket: AdmissionTicket, now: number): Promise<void> {
    this.check();
    for (const [id, item] of this.tickets)
      if (item.expiresAt <= now) this.tickets.delete(id);
    const rate = this.rates.get(ticket.principal.sessionId);
    const active =
      rate && rate.expiresAt > now
        ? rate
        : { expiresAt: now + 60000, count: 0 };
    if (
      this.tickets.size >= 512 ||
      [...this.tickets.values()].filter(
        (item) => item.principal.sessionId === ticket.principal.sessionId,
      ).length >= 4 ||
      active.count >= 10
    )
      throw new Error('REALTIME_LIMIT');
    this.tickets.set(ticket.hash, ticket);
    active.count++;
    this.rates.set(ticket.principal.sessionId, active);
  }
  async consume(
    hash: string,
    purpose: TicketPurpose,
    now: number,
  ): Promise<Principal | null> {
    this.check();
    const record = this.tickets.get(hash);
    if (!record || record.purpose !== purpose || record.expiresAt <= now)
      return null;
    this.tickets.delete(hash);
    return record.principal;
  }
  async addBinding(binding: RealtimeBinding, now: number): Promise<void> {
    this.check();
    if (binding.expiresAt <= now || this.connections.has(binding.client))
      throw new Error('BINDING_CONFLICT');
    this.connections.set(binding.client, binding);
  }
  async binding(client: string): Promise<RealtimeBinding | null> {
    this.check();
    return this.connections.get(client) ?? null;
  }
  async bindings(accountId?: string): Promise<readonly RealtimeBinding[]> {
    this.check();
    return [...this.connections.values()].filter(
      (item) =>
        accountId === undefined || item.principal.accountId === accountId,
    );
  }
  async touchBinding(
    binding: RealtimeBinding,
    expiresAt: number,
  ): Promise<boolean> {
    this.check();
    if (this.connections.get(binding.client) !== binding) return false;
    this.connections.set(binding.client, { ...binding, expiresAt });
    return true;
  }
  async removeBinding(binding: RealtimeBinding): Promise<boolean> {
    this.check();
    if (this.connections.get(binding.client) !== binding) return false;
    return this.connections.delete(binding.client);
  }
  async heartbeat(nodeId: string, expiresAt: number): Promise<void> {
    this.check();
    this.nodeLeases.set(nodeId, expiresAt);
  }
  async nodes(now: number): Promise<readonly string[]> {
    this.check();
    return [...this.nodeLeases]
      .filter(([, expiry]) => expiry > now)
      .map(([id]) => id);
  }
  async removeNode(nodeId: string): Promise<void> {
    this.check();
    this.nodeLeases.delete(nodeId);
  }
  private check(): void {
    if (this.fail) throw new Error('CONTROLLED_STORE_OUTAGE');
  }
}

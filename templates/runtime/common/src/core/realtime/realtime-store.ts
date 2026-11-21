import type { Principal } from '../auth/principal.js';
export type TicketPurpose = 'ws' | 'centrifugo';
export type AdmissionTicket = Readonly<{
  hash: string;
  purpose: TicketPurpose;
  principal: Principal;
  expiresAt: number;
}>;
export type RealtimeBinding = Readonly<{
  client: string;
  principal: Principal;
  user: string;
  channel: string;
  expiresAt: number;
}>;
/** Native owner persistence. No provider credentials or raw admission tickets. */
export interface RealtimeStore {
  assertInitialized(): Promise<void>;
  issue(ticket: AdmissionTicket, now: number): Promise<void>;
  consume(
    hash: string,
    purpose: TicketPurpose,
    now: number,
  ): Promise<Principal | null>;
  addBinding(binding: RealtimeBinding, now: number): Promise<void>;
  binding(client: string): Promise<RealtimeBinding | null>;
  bindings(accountId?: string): Promise<readonly RealtimeBinding[]>;
  touchBinding(binding: RealtimeBinding, expiresAt: number): Promise<boolean>;
  removeBinding(binding: RealtimeBinding): Promise<boolean>;
  heartbeat(nodeId: string, expiresAt: number): Promise<void>;
  nodes(now: number): Promise<readonly string[]>;
  removeNode(nodeId: string): Promise<void>;
}

import { Injectable } from '@nestjs/common';
import type { PushDestination, PushPurpose } from './push.entity.js';
import { registerDestination, removeDestination } from './push-transitions.js';
import type { PushStateStore } from './push-state-store.js';
@Injectable()
export class PushRepository {
  constructor(private readonly store: PushStateStore) {}
  async register(destination: PushDestination): Promise<void> {
    await this.store.change((state) => registerDestination(state, destination));
  }
  async list(
    accountId: string,
    installationId?: string,
    purpose?: PushPurpose,
  ): Promise<readonly PushDestination[]> {
    return (await this.store.read()).destinations.filter(
      (entry) =>
        entry.accountId === accountId &&
        (!installationId || entry.installationId === installationId) &&
        (!purpose || entry.purpose === purpose),
    );
  }
  async current(destination: PushDestination): Promise<boolean> {
    return (await this.store.read()).destinations.some(
      (entry) =>
        entry.id === destination.id &&
        entry.generation === destination.generation &&
        entry.accountId === destination.accountId &&
        entry.sessionId === destination.sessionId &&
        entry.tokenHash === destination.tokenHash,
    );
  }
  async remove(
    accountId: string,
    installationId: string,
    id: string,
    generation: string,
  ): Promise<boolean> {
    let removed = false;
    await this.store.change((state) => {
      const next = removeDestination(
        state,
        accountId,
        installationId,
        id,
        generation,
      );
      removed = state.destinations.length !== next.destinations.length;
      return next;
    });
    return removed;
  }
}

import { Injectable } from '@nestjs/common';
import type {
  PushDestination,
  PushPurpose,
  PushEnvironment,
} from './push.entity.js';
import {
  registerDestination,
  removeDestination,
  sameDestination,
} from './push-transitions.js';
import type { PushStateStore } from './push-state-store.js';
@Injectable()
export class PushRepository {
  constructor(private readonly store: PushStateStore) {}
  async register(destination: PushDestination): Promise<PushDestination> {
    const state = await this.store.change((state) =>
      registerDestination(state, destination),
    );
    return state.destinations.find(
      (entry) =>
        entry.generation === destination.generation &&
        entry.tokenHash === destination.tokenHash,
    )!;
  }
  async list(
    accountId: string,
    installationId?: string,
    purpose?: PushPurpose,
    installationGeneration?: number,
    scope?: string,
    environment?: PushEnvironment,
  ): Promise<readonly PushDestination[]> {
    return (await this.store.read()).destinations.filter(
      (entry) =>
        entry.accountId === accountId &&
        (!installationId || entry.installationId === installationId) &&
        (!purpose || entry.purpose === purpose) &&
        (installationGeneration === undefined ||
          entry.installationGeneration === installationGeneration) &&
        (scope === undefined || entry.scope === scope) &&
        (environment === undefined || entry.environment === environment),
    );
  }
  async current(destination: PushDestination): Promise<boolean> {
    return (await this.store.read()).destinations.some((entry) =>
      sameDestination(entry, destination),
    );
  }
  async removeExact(destination: PushDestination): Promise<boolean> {
    let removed = false;
    await this.store.change((state) => {
      const next = removeDestination(state, destination);
      removed = next.destinations.length !== state.destinations.length;
      return next;
    });
    return removed;
  }
}

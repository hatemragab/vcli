import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { IdentityService } from './identity.service.js';
import type { ProviderCleanupService } from './provider-cleanup.service.js';
import type { ProviderCleanup } from './provider-cleanup.entity.js';
import { newId } from './secret-facts.js';
import { ApplicationError } from '../../core/errors/application-error.js';
export type ProviderCleanupOutcome =
  'completed' | 'retry' | 'unknown' | 'rejected';
export interface FirebaseCleanup {
  cleanup(
    identityKey: string,
    action: ProviderCleanup['action'],
    method: string | null,
  ): Promise<ProviderCleanupOutcome>;
}
/** Explicit bounded drain, restarted by an application-owned scheduler/command. */
@Injectable()
export class ProviderCleanupDispatcher {
  constructor(
    private readonly tx: Transactions,
    private readonly identities: IdentityService,
    private readonly intents: ProviderCleanupService,
    private readonly provider: FirebaseCleanup,
    private readonly clock: () => number = Date.now,
  ) {}
  async drain(
    limit = 10,
  ): Promise<Readonly<{ processed: number; completed: number }>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new ApplicationError('INVALID_DRAIN_LIMIT', 400);
    let processed = 0,
      completed = 0;
    while (processed < limit) {
      const leaseId = newId(),
        claimAt = this.clock();
      const row = await this.tx.run((ctx) =>
        this.intents.claim(claimAt, leaseId, ctx),
      );
      if (!row) break;
      processed++;
      const permitted = await this.tx.run(async (ctx) => {
        const identity = await this.identities.lock(row.identityKey, ctx);
        return (
          !!identity &&
          identity.generation === row.generation &&
          identity.cleanupPending &&
          (row.action === 'unlink' || !identity.active)
        );
      });
      let outcome: ProviderCleanupOutcome = 'rejected';
      if (permitted) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          outcome = await Promise.race([
            this.provider.cleanup(row.identityKey, row.action, row.method),
            new Promise<ProviderCleanupOutcome>((resolve) => {
              timer = setTimeout(() => resolve('unknown'), 10000);
            }),
          ]);
        } catch {
          outcome = 'unknown';
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      const didComplete = await this.tx.run(async (ctx) => {
        const identity = await this.identities.lock(row.identityKey, ctx);
        const current =
          identity?.generation === row.generation && identity.cleanupPending;
        const status = !current
          ? 'exhausted'
          : outcome === 'completed'
            ? 'completed'
            : outcome === 'rejected' || row.attempts >= 8
              ? 'exhausted'
              : outcome === 'unknown'
                ? 'unknown'
                : 'retry';
        const code = !current
          ? 'STALE_BINDING'
          : outcome === 'completed'
            ? 'NONE'
            : outcome === 'retry'
              ? 'PROVIDER_RETRY'
              : outcome === 'unknown'
                ? 'PROVIDER_UNKNOWN'
                : 'PROVIDER_REJECTED';
        const settled = await this.intents.settle(
          row,
          status,
          code,
          this.clock(),
          ctx,
        );
        if (settled && current && status === 'completed') {
          await this.identities.updateLifecycle(
            identity.key,
            identity.generation,
            {
              active: identity.active,
              methods: identity.methods,
              cleanupPending: false,
            },
            ctx,
          );
          return true;
        }
        return false;
      });
      if (didComplete) completed++;
    }
    return { processed, completed };
  }
}

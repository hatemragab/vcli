import { Injectable } from '@nestjs/common';
import type { Transactions } from '../../core/database/transaction-context.js';
import type { IdentityService } from './identity.service.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class IdentityRateLimits {
  constructor(
    private readonly tx: Transactions,
    private readonly identities: IdentityService,
  ) {}
  async spend(
    keys: readonly Readonly<{ key: string; limit: number }>[],
    now: number,
  ): Promise<void> {
    const allowed = await this.tx.run(async (ctx) => {
      let allowed = true;
      for (const entry of keys)
        if (
          !(await this.identities.spendRate(
            entry.key,
            Math.floor(now / 60000),
            entry.limit,
            ctx,
          ))
        )
          allowed = false;
      return allowed;
    });
    if (!allowed) throw new ApplicationError('RATE_LIMITED', 429);
  }
}

import type { Request } from 'express';
import type { IdentityRateLimits } from './identity-rate-limits.service.js';
import { secretHash } from './secret-facts.js';
export async function rateRequest(
  limits: IdentityRateLimits,
  request: Request,
  scope: string,
  now: number,
  identity?: string,
): Promise<void> {
  const entries = [
    {
      key: secretHash(
        'ip:' + scope + ':' + (request.socket.remoteAddress ?? 'unknown'),
      ),
      limit: scope === 'login' ? 20 : scope === 'refresh' ? 60 : 10,
    },
  ];
  if (identity)
    entries.push({
      key: secretHash('identity:' + scope + ':' + identity),
      limit: scope === 'login' ? 6 : 3,
    });
  await limits.spend(entries, now);
}

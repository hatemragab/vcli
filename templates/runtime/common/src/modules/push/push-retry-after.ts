/** Never shorten a provider backoff. Long values are returned to the trusted caller. */
export function pushRetryAfter(
  value: unknown,
  now: number,
  fallback = 60000,
): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const raw = String(value).trim();
  const milliseconds = /^\d+(?:\.\d+)?$/.test(raw)
    ? Number(raw) * 1000
    : Date.parse(raw) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds
    : fallback;
}

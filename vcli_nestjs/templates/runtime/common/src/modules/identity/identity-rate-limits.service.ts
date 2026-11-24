/** Injection token shared by the selected identity controllers. */
export abstract class IdentityRateLimits {
  // Existing controllers supply their request time. Redis supplies the window clock.
  abstract spend(
    entries: readonly Readonly<{ key: string; limit: number }>[],
    _now: number,
  ): Promise<void>;
}

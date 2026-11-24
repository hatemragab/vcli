export interface AccessTokenInput {
  readonly accountId: string;
  readonly sessionId: string;
  readonly installationId: string;
  /** Epoch milliseconds, floored to JWT NumericDate seconds. */
  readonly now: number;
  readonly expiresAt: number;
}

export interface AccessTokenFacts {
  readonly accountId: string;
  readonly sessionId: string;
  readonly installationId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

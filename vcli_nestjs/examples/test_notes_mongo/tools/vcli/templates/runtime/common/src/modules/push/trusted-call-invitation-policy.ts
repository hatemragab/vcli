/** Supplied only by application composition, never by a public request body.
 * Must read current application-owned call facts and authorize this recipient,
 * installation, operation and unexpired ringing invitation on every attempt.
 * No call policy is installed by default. Throws fail closed, without SDK I/O.
 */
export interface TrustedCallInvitationPolicy {
  authorize(
    input: Readonly<{
      accountId: string;
      installationId: string;
      installationGeneration: number;
      callId: string;
      operationId: string;
      expiresAt: number;
      now: number;
    }>,
  ): Promise<boolean>;
}

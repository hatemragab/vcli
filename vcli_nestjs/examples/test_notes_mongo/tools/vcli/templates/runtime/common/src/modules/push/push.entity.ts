export type PushPurpose = 'ordinary' | 'background' | 'voip';
export type PushProvider = 'fcm' | 'apns';
export type PushEnvironment = 'sandbox' | 'production';
export type PushDestination = Readonly<{
  id: string;
  accountId: string;
  sessionId: string;
  installationId: string;
  /** Zero fences legacy rows; only registration may establish a positive binding. */
  installationGeneration: number;
  /** Token generation, independently rotated at every registration. */
  generation: string;
  scope: string;
  environment: PushEnvironment;
  provider: PushProvider;
  purpose: PushPurpose;
  platform: 'android' | 'ios' | 'web';
  token: string;
  tokenHash: string;
  updatedAt: number;
}>;
export type PushState = Readonly<{
  revision: number;
  destinations: readonly PushDestination[];
}>;
export const emptyPushState = (): PushState => ({
  revision: 0,
  destinations: [],
});
export type PushMessage = Readonly<{
  operationId: string;
  purpose: PushPurpose;
  expiresAt: number;
  title?: string;
  body?: string;
  data: Readonly<Record<string, string>>;
}>;
export type PushOutcome =
  | Readonly<{ status: 'accepted'; reference: string }>
  | Readonly<{ status: 'rejected'; code: string; invalidDestination: boolean }>
  | Readonly<{ status: 'unavailable'; code: string; retryAfterMs: number }>
  | Readonly<{ status: 'unknown'; code: string }>;
export type DestinationResult = Readonly<{
  destinationId: string;
  generation: string;
  installationGeneration: number;
  outcome: PushOutcome;
}>;
export type PurposeRoutes = Readonly<
  Partial<Record<PushPurpose, PushProvider>>
>;
export function destinationProjection(destination: PushDestination) {
  return {
    id: destination.id,
    installationId: destination.installationId,
    installationGeneration: destination.installationGeneration,
    provider: destination.provider,
    purpose: destination.purpose,
    platform: destination.platform,
    environment: destination.environment,
    generation: destination.generation,
    updatedAt: destination.updatedAt,
  };
}
/** Provider implementations never throw raw SDK errors through this boundary. */
export type PushSender = Readonly<{
  submit(
    destination: PushDestination,
    message: PushMessage,
    now: number,
    beforeDisclosure?: () => Promise<boolean>,
  ): Promise<PushOutcome>;
}>;
export type PushSenders = Readonly<Partial<Record<PushProvider, PushSender>>>;

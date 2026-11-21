export type PushPurpose = 'ordinary' | 'background' | 'voip';
export type PushProvider = 'fcm' | 'apns';
export type PushDestination = Readonly<{
  id: string;
  accountId: string;
  sessionId: string;
  installationId: string;
  generation: string;
  scope: string;
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
  | Readonly<{
      status: 'accepted';
      reference: string;
    }>
  | Readonly<{
      status: 'rejected';
      code: string;
      invalidDestination: boolean;
    }>
  | Readonly<{
      status: 'unavailable';
      code: string;
      retryAfterMs: number;
    }>
  | Readonly<{
      status: 'unknown';
      code: string;
    }>;
export type DestinationResult = Readonly<{
  destinationId: string;
  generation: string;
  outcome: PushOutcome;
}>;
export type PurposeRoutes = Readonly<
  Partial<Record<PushPurpose, PushProvider>>
>;
export function destinationProjection(destination: PushDestination) {
  return {
    id: destination.id,
    installationId: destination.installationId,
    provider: destination.provider,
    purpose: destination.purpose,
    platform: destination.platform,
    generation: destination.generation,
    updatedAt: destination.updatedAt,
  };
}
/** The only provider boundary: SDK implementations return per-destination outcomes. */
export type PushSender = Readonly<{
  submit(
    destination: PushDestination,
    message: PushMessage,
    now: number,
  ): Promise<PushOutcome>;
}>;
export type PushSenders = Readonly<Partial<Record<PushProvider, PushSender>>>;

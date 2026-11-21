export type ApplicationEvent = Readonly<{
  id: string;
  type: string;
  payload: Readonly<Record<string, unknown>>;
}>;
export type PublicationOutcome = Readonly<{
  status:
    'attempted' | 'provider-accepted' | 'audience-ineligible' | 'unavailable';
  transport: 'socketio' | 'ws' | 'centrifugo';
}>;
export interface EventPublisher {
  publish(
    accountId: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome>;
}

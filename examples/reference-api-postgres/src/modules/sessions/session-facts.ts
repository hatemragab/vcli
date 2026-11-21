export type SessionFacts = Readonly<{
  now: number;
  sessionId: string;
  installationId: string;
  platform: 'android' | 'ios' | 'web' | 'other';
  secretHash: string;
  expiresAt: number;
}>;

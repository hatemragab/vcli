export type Principal = Readonly<{
  accountId: string;
  sessionId: string;
  installationId: string;
  installationGeneration: number;
  expiresAt: number;
}>;
export type AccessProof =
  | Readonly<{
      kind: 'firebase';
      idToken: string;
      sessionSecret: string;
    }>
  | Readonly<{
      kind: 'local';
      accessToken: string;
    }>;

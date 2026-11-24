export type SessionRecord = Readonly<{
  id: string;
  accountId: string;
  installationId: string;
  installationGeneration: number;
  enrollmentGeneration: number;
  kind: 'local' | 'firebase';
  identityKey: string;
  method: string;
  secretHash: string | null;
  authenticatedAt: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}>;

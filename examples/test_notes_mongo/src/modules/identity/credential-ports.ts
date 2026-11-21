export interface Passwords {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
  verifyDummy(password: string): Promise<void>;
}
export type FirebaseIdentity = Readonly<{
  projectId: string;
  uid: string;
  method: string;
  authenticatedAt: number;
  expiresAt: number;
  email: string | null;
  emailVerified: boolean;
  linkedMethods?: readonly string[];
}>;
export interface FirebaseVerifier {
  verify(idToken: string): Promise<FirebaseIdentity>;
  assertCurrent(
    identityKey: string,
    authenticatedAt: number,
    method?: string,
  ): Promise<void>;
}
export interface AccessTokens {
  issue(
    input: Readonly<{
      accountId: string;
      sessionId: string;
      installationId: string;
      expiresAt: number;
      now: number;
    }>,
  ): Promise<string>;
  verify(
    token: string,
    now: number,
  ): Promise<
    Readonly<{
      accountId: string;
      sessionId: string;
      installationId: string;
      expiresAt: number;
    }>
  >;
}

import { Injectable } from '@nestjs/common';
import {
  applicationDefault,
  deleteApp,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import type { FirebaseIdentity, FirebaseVerifier } from './credential-ports.js';
import { ApplicationError } from '../../core/errors/application-error.js';
@Injectable()
export class FirebaseTokenVerifier implements FirebaseVerifier {
  private readonly app: App;
  constructor(private readonly projectId: string) {
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST)
      throw new ApplicationError('FIREBASE_EMULATOR_UNSUPPORTED', 500);
    this.app = initializeApp(
      { projectId, credential: applicationDefault() },
      'app-identity-' + randomUUID(),
    );
  }
  async verify(idToken: string): Promise<FirebaseIdentity> {
    try {
      const token = await getAuth(this.app).verifyIdToken(idToken, true);
      if (
        token.aud !== this.projectId ||
        token.iss !== 'https://securetoken.google.com/' + this.projectId ||
        token.uid !== token.sub ||
        !token.auth_time
      )
        throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
      const current = await getAuth(this.app).getUser(token.uid);
      if (current.disabled)
        throw new ApplicationError('FIREBASE_USER_DISABLED', 401);
      if (
        !current.providerData.some(
          (value) => value.providerId === token.firebase.sign_in_provider,
        )
      )
        throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
      return {
        linkedMethods: [
          ...new Set(current.providerData.map((value) => value.providerId)),
        ],
        projectId: this.projectId,
        uid: token.uid,
        method: token.firebase.sign_in_provider,
        authenticatedAt: token.auth_time * 1000,
        expiresAt: token.exp * 1000,
        email: current.email ?? null,
        emailVerified: current.emailVerified === true,
      };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      const code = firebaseErrorCode(error);
      if (code === 'auth/id-token-revoked')
        throw new ApplicationError('FIREBASE_TOKEN_REVOKED', 401);
      if (code === 'auth/user-disabled')
        throw new ApplicationError('FIREBASE_USER_DISABLED', 401);
      if (
        code &&
        [
          'auth/argument-error',
          'auth/id-token-expired',
          'auth/invalid-id-token',
          'auth/user-not-found',
          'auth/invalid-argument',
        ].includes(code)
      )
        throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
      throw new ApplicationError('FIREBASE_UNAVAILABLE', 503);
    }
  }
  async assertCurrent(
    identityKey: string,
    authenticatedAt: number,
    method?: string,
  ): Promise<void> {
    const prefix = 'firebase:' + this.projectId + ':';
    if (!identityKey.startsWith(prefix))
      throw new ApplicationError('INVALID_FIREBASE_TOKEN', 401);
    try {
      const user = await getAuth(this.app).getUser(
        identityKey.slice(prefix.length),
      );
      if (user.disabled)
        throw new ApplicationError('FIREBASE_USER_DISABLED', 401);
      if (
        method &&
        !user.providerData.some((value) => value.providerId === method)
      )
        throw new ApplicationError('FIREBASE_TOKEN_REVOKED', 401);
      if (
        user.tokensValidAfterTime &&
        authenticatedAt < new Date(user.tokensValidAfterTime).getTime()
      )
        throw new ApplicationError('FIREBASE_TOKEN_REVOKED', 401);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (firebaseErrorCode(error) === 'auth/user-not-found')
        throw new ApplicationError('FIREBASE_TOKEN_REVOKED', 401);
      throw new ApplicationError('FIREBASE_UNAVAILABLE', 503);
    }
  }
  /** No call occurs in a DB transaction; unknown acceptance must retain the app fence. */
  async cleanup(
    identityKey: string,
    action: 'revoke' | 'delete' | 'unlink',
    method: string | null,
  ): Promise<'completed' | 'retry' | 'unknown' | 'rejected'> {
    const prefix = 'firebase:' + this.projectId + ':';
    if (!identityKey.startsWith(prefix)) return 'rejected';
    const uid = identityKey.slice(prefix.length);
    if (!uid) return 'rejected';
    try {
      const auth = getAuth(this.app);
      if (action === 'delete') await auth.deleteUser(uid);
      else if (action === 'revoke') await auth.revokeRefreshTokens(uid);
      else {
        if (
          !method ||
          !['password', 'phone', 'google.com', 'apple.com'].includes(method)
        )
          return 'rejected';
        await auth.updateUser(uid, { providersToUnlink: [method] });
      }
      return 'completed';
    } catch (error) {
      const code = firebaseErrorCode(error);
      if (code === 'auth/user-not-found') return 'completed';
      if (
        code === 'app/invalid-credential' ||
        code === 'auth/invalid-credential'
      )
        return 'retry';
      if (
        code === 'auth/insufficient-permission' ||
        code === 'auth/invalid-argument'
      )
        return 'rejected';
      return 'unknown';
    }
  }
  actionLinksAuth(): Pick<
    Auth,
    'generateEmailVerificationLink' | 'generatePasswordResetLink'
  > {
    return getAuth(this.app);
  }
  async close(): Promise<void> {
    await deleteApp(this.app);
  }
}
function firebaseErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code;
  return undefined;
}

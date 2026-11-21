import { Injectable } from '@nestjs/common';
import {
  applicationDefault,
  deleteApp,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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
      'reference-identity-' + randomUUID(),
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
      return {
        projectId: this.projectId,
        uid: token.uid,
        method: token.firebase.sign_in_provider,
        authenticatedAt: token.auth_time * 1000,
        expiresAt: token.exp * 1000,
        email: token.email ?? null,
        emailVerified: token.email_verified === true,
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

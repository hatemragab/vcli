import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FirebaseTokenVerifier } from '../dist/modules/identity/firebase-token-verifier.service.js';
import { ApplicationError } from '../dist/core/errors/application-error.js';
const unknownErrors: readonly unknown[] = [
  null,
  undefined,
  'provider failure',
  42,
  {},
  { code: 42 },
  { code: 'auth/unrecognized-failure' },
];
function verifierFixture(t: { after(work: () => Promise<void>): void }) {
  const existing = new Set(getApps());
  const verifier = new FirebaseTokenVerifier('error-boundary-test');
  t.after(() => verifier.close());
  const app = getApps().find((candidate) => !existing.has(candidate));
  assert.ok(app);
  return { verifier, auth: getAuth(app) };
}
const rejectsCode = (expected: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === expected;
test('Firebase ID-token SDK catch handles null and unknown error shapes without changing safe mappings', async (t) => {
  const { verifier, auth } = verifierFixture(t);
  let sdkError: unknown;
  t.mock.method(auth, 'verifyIdToken', async () => {
    throw sdkError;
  });
  for (const value of unknownErrors) {
    sdkError = value;
    await assert.rejects(
      verifier.verify('test-only-non-issued-token'),
      rejectsCode('FIREBASE_UNAVAILABLE'),
    );
  }
  for (const [code, expected] of [
    ['auth/id-token-revoked', 'FIREBASE_TOKEN_REVOKED'],
    ['auth/user-disabled', 'FIREBASE_USER_DISABLED'],
    ['auth/argument-error', 'INVALID_FIREBASE_TOKEN'],
    ['auth/id-token-expired', 'INVALID_FIREBASE_TOKEN'],
    ['auth/invalid-id-token', 'INVALID_FIREBASE_TOKEN'],
    ['auth/user-not-found', 'INVALID_FIREBASE_TOKEN'],
    ['auth/invalid-argument', 'INVALID_FIREBASE_TOKEN'],
  ] as const) {
    sdkError = { code };
    await assert.rejects(
      verifier.verify('test-only-non-issued-token'),
      rejectsCode(expected),
    );
  }
});
test('Firebase current-user SDK catch handles null and unknown shapes, preserves application errors and treats a missing user as revoked', async (t) => {
  const { verifier, auth } = verifierFixture(t);
  let sdkError: unknown;
  t.mock.method(auth, 'getUser', async () => {
    throw sdkError;
  });
  for (const value of unknownErrors) {
    sdkError = value;
    await assert.rejects(
      verifier.assertCurrent('firebase:error-boundary-test:test-user', 0),
      rejectsCode('FIREBASE_UNAVAILABLE'),
    );
  }
  sdkError = { code: 'auth/user-not-found' };
  await assert.rejects(
    verifier.assertCurrent('firebase:error-boundary-test:test-user', 0),
    rejectsCode('FIREBASE_TOKEN_REVOKED'),
  );
  sdkError = new ApplicationError('FIREBASE_USER_DISABLED', 401);
  await assert.rejects(
    verifier.assertCurrent('firebase:error-boundary-test:test-user', 0),
    (error: unknown) => error === sdkError,
  );
});

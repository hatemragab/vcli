import { ApplicationError } from '../../core/errors/application-error.js';
import { approvedActionUrl } from './render-message.js';
export type EmailActionPurpose = 'verification' | 'password-reset';
export type FirebaseActionPolicy = Readonly<{
  continueOrigins: readonly string[];
  linkDomain?: string;
  handleCodeInApp?: boolean;
  iOS?: Readonly<{ bundleId: string }>;
  android?: Readonly<{
    packageName: string;
    installApp?: boolean;
    minimumVersion?: string;
  }>;
}>;
export function validateFirebaseActionPolicy(
  policy: FirebaseActionPolicy,
): void {
  if (
    !policy ||
    !Array.isArray(policy.continueOrigins) ||
    policy.continueOrigins.length < 1 ||
    policy.continueOrigins.length > 16
  )
    throw new ApplicationError('INVALID_FIREBASE_ACTION_POLICY', 500);
  for (const origin of policy.continueOrigins) {
    if (approvedActionUrl(origin, origin) !== new URL(origin).origin + '/')
      throw new ApplicationError('INVALID_FIREBASE_ACTION_POLICY', 500);
  }
  const domain = policy.linkDomain;
  if (
    domain !== undefined &&
    (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ||
      /(^|\.)(web\.app|firebaseapp\.com)$/.test(domain))
  )
    throw new ApplicationError('INVALID_FIREBASE_LINK_DOMAIN', 500);
  if (
    (policy.handleCodeInApp !== undefined &&
      typeof policy.handleCodeInApp !== 'boolean') ||
    (policy.iOS &&
      !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(policy.iOS.bundleId)) ||
    (policy.android &&
      (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(
        policy.android.packageName,
      ) ||
        (policy.android.installApp !== undefined &&
          typeof policy.android.installApp !== 'boolean') ||
        (policy.android.minimumVersion !== undefined &&
          !/^\d{1,10}$/.test(policy.android.minimumVersion)))) ||
    (policy.handleCodeInApp === true && !policy.iOS && !policy.android)
  )
    throw new ApplicationError('INVALID_FIREBASE_ACTION_POLICY', 500);
}
/** Provider-managed clients receive settings only; caller supplies verified actor policy. */
export function firebaseActionSettings(
  policy: FirebaseActionPolicy,
  purpose: EmailActionPurpose,
  continueUrl: string,
) {
  validateFirebaseActionPolicy(policy);
  if (!['verification', 'password-reset'].includes(purpose))
    throw new ApplicationError('INVALID_ACTION_PURPOSE', 400);
  const origin = policy.continueOrigins.find((candidate) => {
    try {
      return new URL(candidate).origin === new URL(continueUrl).origin;
    } catch {
      return false;
    }
  });
  if (!origin || continueUrl.length > 2048)
    throw new ApplicationError('UNAPPROVED_ACTION_URL', 400);
  return {
    url: approvedActionUrl(continueUrl, origin),
    handleCodeInApp: policy.handleCodeInApp ?? false,
    ...(policy.linkDomain ? { linkDomain: policy.linkDomain } : {}),
    ...(policy.iOS ? { iOS: { ...policy.iOS } } : {}),
    ...(policy.android ? { android: { ...policy.android } } : {}),
  };
}
/** Never forward account-existence or raw provider messages to a public response. */
export function publicEmailActionResponse(): Readonly<{ accepted: true }> {
  return { accepted: true };
}
export function classifyFirebaseActionError(
  error: unknown,
): 'suppressed' | 'unavailable' | 'configuration' {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (
    [
      'auth/user-not-found',
      'auth/user-disabled',
      'auth/invalid-email',
      'auth/email-not-found',
    ].includes(code)
  )
    return 'suppressed';
  if (
    [
      'auth/invalid-continue-uri',
      'auth/unauthorized-continue-uri',
      'auth/invalid-dynamic-link-domain',
      'auth/invalid-hosting-link-domain',
      'auth/insufficient-permission',
      'auth/invalid-credential',
    ].includes(code)
  )
    return 'configuration';
  return 'unavailable';
}

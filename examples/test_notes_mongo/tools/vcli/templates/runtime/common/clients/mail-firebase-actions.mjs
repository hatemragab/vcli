// Client-owned example. Install the current Firebase JS SDK in your CLIENT project.
// Pass Auth initialized with the SAME Firebase project as the selected server.
import {
  sendEmailVerification,
  sendPasswordResetEmail,
  checkActionCode,
  applyActionCode,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from 'firebase/auth';

function continueUrl(value, origins) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.protocol !== 'https:' ||
    !origins.includes(url.origin)
  )
    throw new Error('UNAPPROVED_CONTINUE_URL');
  return url.href;
}
export async function sendManagedVerification(user, settings) {
  // Obtain settings from configured purpose-bound application policy. Never accept arbitrary domains.
  await sendEmailVerification(user, settings);
  return { accepted: true };
}
export async function requestManagedReset(auth, email, settings) {
  try {
    await sendPasswordResetEmail(auth, email, settings);
  } catch (error) {
    if (
      ![
        'auth/user-not-found',
        'auth/invalid-email',
        'auth/user-disabled',
      ].includes(error?.code)
    )
      throw new Error('ACTION_REQUEST_UNAVAILABLE');
  }
  return { accepted: true };
}
export async function completeFirebaseAction(
  auth,
  href,
  expectedPurpose,
  allowedHandlerOrigins,
  allowedContinueOrigins,
  newPassword,
) {
  const url = new URL(href);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !allowedHandlerOrigins.includes(url.origin)
  )
    throw new Error('UNAPPROVED_ACTION_HANDLER');
  const expectedMode = {
    verification: 'verifyEmail',
    'password-reset': 'resetPassword',
  }[expectedPurpose];
  const code = url.searchParams.get('oobCode'),
    mode = url.searchParams.get('mode');
  if (!expectedMode || mode !== expectedMode || !code || code.length > 4096)
    throw new Error('INVALID_ACTION_PURPOSE');
  // Validate redirect BEFORE consuming a valid code. Never navigate to arbitrary continueUrl.
  const redirect = url.searchParams.get('continueUrl');
  const approved = redirect
    ? continueUrl(redirect, allowedContinueOrigins)
    : undefined;
  if (mode === 'verifyEmail') {
    const info = await checkActionCode(auth, code);
    if (info.operation !== 'VERIFY_EMAIL')
      throw new Error('INVALID_ACTION_PURPOSE');
    await applyActionCode(auth, code);
  } else {
    await verifyPasswordResetCode(auth, code);
    if (typeof newPassword !== 'string' || !newPassword)
      throw new Error('PASSWORD_REQUIRED');
    await confirmPasswordReset(auth, code, newPassword);
  }
  // Caller may navigate only after success; expired/used/invalid code errors stay generic.
  return { completed: true, continueUrl: approved };
}

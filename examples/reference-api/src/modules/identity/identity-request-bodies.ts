import type { ApiBodyOptions } from '@nestjs/swagger';
import { z } from 'zod';
import {
  changeInput,
  credentials,
  emailInput,
  firebaseInput,
  loginInput,
  refreshInput,
  resetInput,
  verificationInput,
} from './identity-inputs.js';
type RequestSchema = Extract<
  ApiBodyOptions,
  {
    schema: unknown;
  }
>['schema'];
function requestBody<T extends z.ZodType>(
  input: T,
  description: string,
  example: z.input<T>,
): ApiBodyOptions {
  return {
    required: true,
    description,
    // Zod's static return type spans every JSON Schema draft. This explicit target
    // emits the OpenAPI 3.0 schema subset accepted by Nest's SchemaObject.
    schema: z.toJSONSchema(input, {
      target: 'openapi-3.0',
      io: 'input',
    }) as RequestSchema,
    examples: {
      request: {
        summary: 'Illustrative input; replace before sending',
        value: example,
      },
    },
  };
}
const exampleEmail = 'developer@example.invalid';
const examplePassword = 'example-only-password-123';
const nonIssuedCapability = 'A'.repeat(43);
export const identityRequestBodies = {
  register: requestBody(
    credentials,
    'Register a pending local account and request verification mail. The proof holder must choose the actual password again at verification confirmation; duplicate signup never establishes or changes a verified credential. The 202 response is enumeration-safe and does not create a session. The example address and password are illustrative only.',
    { email: exampleEmail, password: examplePassword },
  ),
  login: requestBody(
    loginInput,
    'Log in with a verified local account using the password chosen at verification confirmation or the latest password reset/change. Returns a short-lived access JWT and a strictly rotating refresh capability.',
    { email: exampleEmail, password: examplePassword, platform: 'other' },
  ),
  refresh: requestBody(
    refreshInput,
    'Replace the placeholder with the latest refresh capability. Each credential is single-use: replay revokes its session family, and a lost response requires reauthentication. Coordinate one in-flight refresh per session.',
    { refreshToken: nonIssuedCapability },
  ),
  verificationRequest: requestBody(
    emailInput,
    'Request a verification email if the account is eligible. The accepted response does not disclose account existence or mail delivery.',
    { email: exampleEmail },
  ),
  verificationConfirm: requestBody(
    verificationInput,
    'Replace the non-issued placeholder with the capability from the private verification email and explicitly choose your password. Confirmation atomically establishes that password, verifies email, invalidates older credential actions and revokes all existing account sessions. It never activates a prior pending signup password implicitly and does not create a session; log in afterward. The action is purpose-bound, expiring and single-use.',
    { token: nonIssuedCapability, password: examplePassword },
  ),
  resetRequest: requestBody(
    emailInput,
    'Request a password reset if the account is eligible. The accepted response does not disclose account existence or mail delivery.',
    { email: exampleEmail },
  ),
  resetConfirm: requestBody(
    resetInput,
    'Replace the non-issued placeholder with the private reset capability and choose a new password. Confirmation consumes the action, invalidates older credential actions and revokes all account sessions.',
    {
      token: nonIssuedCapability,
      password: 'example-only-replacement-password-123',
    },
  ),
  passwordChange: requestBody(
    changeInput,
    'Requires a local bearer access JWT, current password and recent session authentication. A successful change revokes all account sessions, including the caller, so log in again.',
    {
      currentPassword: examplePassword,
      newPassword: 'example-only-replacement-password-123',
    },
  ),
  firebaseBootstrap: requestBody(
    firebaseInput,
    'Replace the placeholder with a real Firebase client ID token after recent password, phone, Google or Apple sign-in. Enrollment checks the configured project, allowed method and durable revocation cutoff. Returns an opaque app-session capability, with no second API JWT pair.',
    { idToken: 'PASTE_REAL_FIREBASE_CLIENT_ID_TOKEN', platform: 'other' },
  ),
} satisfies Record<string, ApiBodyOptions>;

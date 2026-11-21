import { validPasswordInput } from '../../core/auth/password-input.js';
import { z } from 'zod';
export const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .describe('Email address, canonicalized to lower case after validation.');
// Preserve Unicode exactly. Bound UTF-16 code units and UTF-8 bytes; never truncate/normalize passwords.
export const password = z
  .string()
  .min(12)
  .max(128)
  .refine(validPasswordInput)
  .meta({
    format: 'password',
    writeOnly: true,
    description:
      '12–128 UTF-16 code units and at most 256 UTF-8 bytes; Unicode is preserved without normalization or truncation. The byte limit is enforced at runtime.',
  });
export const secret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u)
  .meta({
    writeOnly: true,
    description:
      '43-character base64url capability from the relevant response or private action email. Documentation examples are non-issued placeholders.',
  });
export const platform = z
  .enum(['android', 'ios', 'web', 'other'])
  .default('other')
  .describe(
    'Client-reported platform metadata; this does not prove hardware identity.',
  );
export const credentials = z.strictObject({ email, password });
export const installationInput = z.strictObject({
  installationCapability: secret,
  allowRebind: z.boolean().default(false),
});
export const loginInput = credentials.extend({
  platform,
  ...installationInput.shape,
});
export const emailInput = z.strictObject({ email });
export const actionInput = z.strictObject({ token: secret });
export const verificationInput = actionInput.extend({ password });
export const resetInput = actionInput.extend({ password });
export const refreshInput = z.strictObject({ refreshToken: secret });
export const firebaseInput = z.strictObject({
  sessionCapability: secret,
  ...installationInput.shape,
  idToken: z.string().min(1).max(16384).meta({
    writeOnly: true,
    description:
      'Real Firebase client ID token for the configured project after recent provider sign-in; never a Google/Apple provider access token.',
  }),
  platform,
});
export const changeInput = z.strictObject({
  currentPassword: password,
  newPassword: password,
});

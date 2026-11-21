import { z } from 'zod';
import { validPasswordInput } from '../../core/auth/password-input.js';

export const username = z
  .string()
  .max(128)
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
  .toLowerCase()
  .describe(
    '3–64 ASCII letters, numbers, dots, underscores or hyphens, beginning with a letter or number. Surrounding whitespace is removed and ASCII letters are canonicalized to lower case. This identifier is not an email address.',
  );
export const password = z
  .string()
  .min(12)
  .max(128)
  .refine(validPasswordInput)
  .meta({
    format: 'password',
    writeOnly: true,
    description:
      '12–128 UTF-16 code units and at most 256 UTF-8 bytes; Unicode is preserved without normalization or truncation.',
  });
export const secret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u)
  .meta({ writeOnly: true });
export const platform = z
  .enum(['android', 'ios', 'web', 'other'])
  .default('other');
export const installationInput = z.strictObject({
  installationCapability: secret,
  allowRebind: z.boolean().default(false),
});
export const credentials = z.strictObject({ username, password });
export const loginInput = credentials.extend({
  platform,
  ...installationInput.shape,
});
export const refreshInput = z.strictObject({ refreshToken: secret });
export const changeInput = z.strictObject({
  currentPassword: password,
  newPassword: password,
});

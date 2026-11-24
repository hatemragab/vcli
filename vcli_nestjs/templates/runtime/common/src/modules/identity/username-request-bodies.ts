import type { ApiBodyOptions } from '@nestjs/swagger';
import { z } from 'zod';
import {
  credentials,
  loginInput,
  refreshInput,
  changeInput,
} from './username-inputs.js';

type RequestSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];
function requestBody<T extends z.ZodType>(
  schema: T,
  description: string,
  example: z.input<T>,
): ApiBodyOptions {
  return {
    required: true,
    description,
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    }) as RequestSchema,
    examples: { request: { value: example } },
  };
}
const exampleUsername = 'example_user';
const examplePassword = 'example-only-password-123';
export const identityRequestBodies = {
  register: requestBody(
    credentials,
    'Register a username and establish its password without email. An accepted response never replaces an existing credential and does not create a session. Usernames are public identifiers, not verified email addresses. No email verification or forgotten-password endpoint exists in this profile.',
    { username: exampleUsername, password: examplePassword },
  ),
  login: requestBody(
    loginInput,
    'Authenticate a registered username and password with a separate private installation capability. Returns a short-lived JWT and a strictly rotating refresh capability. No email claim is made.',
    {
      username: exampleUsername,
      password: examplePassword,
      platform: 'other',
      installationCapability: 'A'.repeat(43),
    },
  ),
  refresh: requestBody(
    refreshInput,
    'Use the latest single-use refresh capability. Replay revokes its session family; a lost response requires reauthentication. Serialize refresh across clients sharing a session.',
    { refreshToken: 'A'.repeat(43) },
  ),
  passwordChange: requestBody(
    changeInput,
    'Requires a bearer access JWT, current password and recent authentication. Changes the password and revokes all sessions, including the caller. Forgotten-password recovery is unavailable in this mail-free profile.',
    {
      currentPassword: examplePassword,
      newPassword: 'example-only-replacement-password-123',
    },
  ),
} satisfies Record<string, ApiBodyOptions>;

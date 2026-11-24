import type { ApiBodyOptions } from '@nestjs/swagger';
import { z } from 'zod';
import { validPasswordInput } from '../../core/auth/password-input.js';

const email = z
  .string()
  .max(254)
  .trim()
  .pipe(z.email().toLowerCase())
  .meta({ format: 'email' });
const username = z
  .string()
  .max(128)
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)
  .toLowerCase();
const password = z.string().min(12).max(128).refine(validPasswordInput).meta({
  format: 'password',
  writeOnly: true,
  description: '12–128 UTF-16 code units and at most 256 UTF-8 bytes.',
});

const emailCredentials = z.strictObject({ email, password });
const usernameCredentials = z.strictObject({ username, password });

export const credentialInputs = {
  email: emailCredentials.transform(({ email, password }) => ({
    identifier: email,
    password,
  })),
  username: usernameCredentials.transform(({ username, password }) => ({
    identifier: username,
    password,
  })),
};

export type AuthIdentifier = keyof typeof credentialInputs;

type RequestSchema = Extract<ApiBodyOptions, { schema: unknown }>['schema'];

export const credentialRequestBody: ApiBodyOptions = {
  required: true,
  description: 'Provide the email or username configured for this application.',
  schema: {
    oneOf: [emailCredentials, usernameCredentials].map(
      (schema) =>
        z.toJSONSchema(schema, {
          target: 'openapi-3.0',
          io: 'input',
        }) as RequestSchema,
    ),
  },
};

import type { ZodType } from 'zod';
import { ApplicationError } from '../errors/application-error.js';
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError('INVALID_REQUEST', 400);
  return result.data;
}

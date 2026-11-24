import type { ZodType } from 'zod';
import { ApplicationError } from '../errors/application-error.js';

function fieldNames(issues: readonly { path?: readonly unknown[] }[]): string[] {
  const names: string[] = [];
  for (const issue of issues) {
    for (const part of issue.path ?? []) {
      if (
        typeof part === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(part) &&
        !names.includes(part)
      )
        names.push(part);
    }
    if (names.length >= 8) break;
  }
  return names.slice(0, 8);
}

export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApplicationError(
      'INVALID_REQUEST',
      400,
      'INVALID_REQUEST',
      fieldNames(result.error.issues),
    );
  return result.data;
}

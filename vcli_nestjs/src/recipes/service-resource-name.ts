import { createHash } from 'node:crypto';
import { projectNameSchema } from '../contracts.js';

/** Retain full project metadata while bounding native resource identifiers to 63 characters. */
export function serviceResourceName(project: string, suffix: string): string {
  if (!projectNameSchema.safeParse(project).success)
    throw new Error('INVALID_SERVICE_PROJECT');
  if (!/^[a-z][a-z0-9-]*$/.test(suffix))
    throw new Error('INVALID_SERVICE_RESOURCE_SUFFIX');
  const original = project + '-' + suffix;
  const normalized = original.replace(/[._]/g, '-');
  if (normalized === original && normalized.length <= 63) return normalized;
  return (
    normalized.slice(0, 46).replace(/-+$/, '') +
    '-' +
    createHash('sha256').update(original).digest('hex').slice(0, 16)
  );
}

import type { JsonValue } from '../contracts.js';
import type { PackageFields } from './types.js';
import { canonical, json, parseJson, rejectPrivateValues } from './data.js';
import { EngineError } from './engine-error.js';

export const isManagedDocumentation = (file: string): boolean =>
  file === 'README.md' || file === 'AGENTS.md';
export const REGION_START = '<!-- vcli:managed:start -->';
export const REGION_END = '<!-- vcli:managed:end -->';
export function managedRegion(
  content: string,
): { start: number; end: number; content: string } | null {
  const start = content.indexOf(REGION_START);
  const endStart = content.indexOf(REGION_END);
  if (start < 0 && endStart < 0) return null;
  if (
    start < 0 ||
    endStart < start ||
    content.indexOf(REGION_START, start + 1) >= 0 ||
    content.indexOf(REGION_END, endStart + 1) >= 0
  )
    throw new EngineError(
      'MANAGED_CONFLICT',
      'planning',
      'Restore one well-formed bounded VCLI documentation region.',
    );
  const end = endStart + REGION_END.length;
  return { start, end, content: content.slice(start, end) };
}
export function replaceRegion(before: string, next: string): string {
  const previous = managedRegion(before);
  const rendered = managedRegion(next);
  if (!previous || !rendered)
    throw new EngineError(
      'MANAGED_CONFLICT',
      'planning',
      'Restore the documented managed region anchors before regenerating.',
    );
  return (
    before.slice(0, previous.start) +
    rendered.content +
    before.slice(previous.end)
  );
}
function packageObject(content: string): Record<string, JsonValue> {
  const value = parseJson(content, 'package');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EngineError(
      'INVALID_STATE',
      'package',
      'Use an ordinary JSON package manifest.',
    );
  rejectPrivateValues(value);
  return value as Record<string, JsonValue>;
}
function escapeKey(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
function unescapeKey(key: string): string {
  return key.replaceAll('~1', '/').replaceAll('~0', '~');
}
// Older locks recorded the app version. Treat it as app-owned when reading them too.
const appVersionField = '/version';

function fieldsOf(
  value: Record<string, JsonValue>,
  prefix = '',
): PackageFields {
  const fields: PackageFields = {};
  for (const [key, item] of Object.entries(value)) {
    const field = `${prefix}/${escapeKey(key)}`;
    if (field === appVersionField) continue;
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.keys(item).length
    )
      Object.assign(fields, fieldsOf(item, field));
    else fields[field] = item;
  }
  return fields;
}
function getField(
  value: Record<string, JsonValue>,
  field: string,
): JsonValue | undefined {
  let cursor: JsonValue | undefined = value;
  for (const key of field.slice(1).split('/').map(unescapeKey)) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor))
      return undefined;
    cursor = Object.hasOwn(cursor, key) ? cursor[key] : undefined;
  }
  return cursor;
}
function setField(
  value: Record<string, JsonValue>,
  field: string,
  item: JsonValue | undefined,
): void {
  const keys = field.slice(1).split('/').map(unescapeKey);
  let cursor = value;
  for (const key of keys.slice(0, -1)) {
    const child = cursor[key];
    if (child === undefined) cursor[key] = {};
    else if (
      child === null ||
      typeof child !== 'object' ||
      Array.isArray(child)
    )
      throw new EngineError(
        'MANAGED_CONFLICT',
        'package',
        'Preserve the declared package object shape or resolve the conflict manually.',
      );
    cursor = cursor[key] as Record<string, JsonValue>;
  }
  const last = keys.at(-1)!;
  if (item === undefined) delete cursor[last];
  else cursor[last] = item;
}
export function validatePackageFields(
  content: string,
  fields: PackageFields,
): void {
  validateFields(packageObject(content), fields);
}
function validateFields(
  current: Record<string, JsonValue>,
  fields: PackageFields,
): void {
  for (const [field, item] of Object.entries(fields))
    if (
      field !== appVersionField &&
      canonical(getField(current, field)) !== canonical(item)
    )
      throw new EngineError(
        'MANAGED_CONFLICT',
        'package',
        'Restore changed selected scripts, dependencies or managed package fields before generation.',
      );
}
export function mergePackage(
  before: string | null,
  rendered: string,
  oldFields: PackageFields,
): { content: string; fields: PackageFields } {
  const target = packageObject(rendered);
  const fields = fieldsOf(target);
  if (before === null) return { content: json(target), fields };
  const current = packageObject(before);
  validateFields(current, oldFields);
  for (const [field, item] of Object.entries(fields)) {
    const existing = getField(current, field);
    if (
      !Object.hasOwn(oldFields, field) &&
      existing !== undefined &&
      canonical(existing) !== canonical(item)
    )
      throw new EngineError(
        'MANAGED_CONFLICT',
        'package',
        'Resolve the custom package field collision explicitly before adding this capability.',
      );
    // A package must not be installed in conflicting dependency sections.
    if (/^\/(?:dependencies|devDependencies)\//.test(field)) {
      const opposite = field.startsWith('/dependencies/')
        ? field.replace('/dependencies/', '/devDependencies/')
        : field.replace('/devDependencies/', '/dependencies/');
      if (
        getField(current, opposite) !== undefined &&
        !Object.hasOwn(oldFields, opposite)
      )
        throw new EngineError(
          'MANAGED_CONFLICT',
          'package',
          'Resolve the selected dependency already declared in another dependency section.',
        );
    }
    setField(current, field, item);
  }
  for (const field of Object.keys(oldFields))
    if (field !== appVersionField && !Object.hasOwn(fields, field))
      setField(current, field, undefined);
  return { content: json(current), fields };
}

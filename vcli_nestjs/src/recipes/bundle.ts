import { readFile } from 'node:fs/promises';
import type { RenderedFile } from '../contracts.js';

function missingTemplate(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/** All asset paths are code-owned; callers cannot select arbitrary filesystem input. */
export async function bundled(
  path: string,
  variant = 'common',
): Promise<RenderedFile> {
  if (
    !/^[a-z0-9/_.-]+$/i.test(path) ||
    path.split('/').includes('..') ||
    !['common', 'mongodb', 'postgres'].includes(variant)
  )
    throw new Error('INVALID_BUNDLED_TEMPLATE');
  let content: string;
  try {
    content = await readFile(
      new URL(`../../templates/runtime/${variant}/${path}`, import.meta.url),
      'utf8',
    );
  } catch (error) {
    if (missingTemplate(error)) throw error;
    throw new Error('INVALID_BUNDLED_TEMPLATE', { cause: error });
  }
  const template = `${variant}/${path}`;
  return {
    path,
    content,
    ownership: 'scaffold',
    ...(/^[a-z0-9./_-]{1,160}$/.test(template)
      ? { provenance: { renderer: 'template', template } }
      : {}),
  };
}
export const file = (
  path: string,
  content: string,
  ownership: RenderedFile['ownership'] = 'managed',
): RenderedFile => ({ path, content, ownership });
export const json = (value: unknown): string =>
  JSON.stringify(value, null, 2) + '\n';

export async function runtime(
  path: string,
  variant: string,
): Promise<RenderedFile> {
  try {
    return await bundled(path, variant);
  } catch (error) {
    if (!missingTemplate(error)) throw error;
    return bundled(path);
  }
}

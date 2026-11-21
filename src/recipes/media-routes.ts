import { distributionFailure } from '../contracts.js';

const modes = ['mediated', 'presigned', 'multipart'] as const;
type UploadMode = (typeof modes)[number];

function sliceMarked(
  source: string,
  name: string,
): { start: number; end: number } {
  const start = source.indexOf(`// vcli-route:${name}`);
  const end = source.indexOf('// vcli-route:end', start + 1);
  if (start < 0 || end < 0)
    throw distributionFailure(
      'INVALID_CATALOG',
      'The media controller template is missing a route marker.',
      { option: 'MEDIA_ROUTES_TEMPLATE' },
    );
  return { start, end: end + '// vcli-route:end'.length };
}

/** Keep authorization on the routes that the selected upload modes actually expose. */
export function retainSelectedMediaRoutes(
  source: string,
  selected: readonly string[],
): string {
  const chosen = modes.filter((mode) => selected.includes(mode));
  if (!chosen.length)
    throw distributionFailure(
      'INVALID_CATALOG',
      'Media generation received no supported upload mode.',
      { option: 'MEDIA_ROUTES_TEMPLATE' },
    );
  if (
    !source.includes('// vcli-route:grant') ||
    !source.includes('// vcli-route:multipart')
  )
    throw distributionFailure(
      'INVALID_CATALOG',
      'The media controller template is missing a route marker.',
      { option: 'MEDIA_ROUTES_TEMPLATE' },
    );
  let next = source;
  const drop = (name: string, enabled: boolean) => {
    if (enabled) return;
    const range = sliceMarked(next, name);
    next = next.slice(0, range.start) + next.slice(range.end);
  };
  drop('grant', chosen.includes('presigned'));
  drop('multipart', chosen.includes('multipart'));
  if (!chosen.includes('multipart')) {
    const start = next.indexOf('// vcli-schema:part');
    const end = next.indexOf('// vcli-schema:end', start + 1);
    if (start < 0 || end < 0)
      throw distributionFailure(
        'INVALID_CATALOG',
        'The media controller template is missing a route marker.',
        { option: 'MEDIA_ROUTES_TEMPLATE' },
      );
    next = next.slice(0, start) + next.slice(end + '// vcli-schema:end'.length);
  }
  const literal = chosen.map((mode) => `'${mode}'`).join(', ');
  const first: UploadMode = chosen[0]!;
  next = next.replace(
    "z.enum(['mediated', 'presigned', 'multipart']).default('mediated')",
    `z.enum([${literal}]).default('${first}')`,
  );
  next = next.replaceAll(
    "enum: ['mediated', 'presigned', 'multipart']",
    `enum: [${literal}]`,
  );
  return next;
}

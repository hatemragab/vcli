import { distributionFailure } from '../contracts.js';

/** Guarded template marker helpers. Missing markers fail loudly instead of slicing from -1. */
export function requireIndex(
  source: string,
  marker: string,
  template: string,
  fromIndex = 0,
): number {
  const index = source.indexOf(marker, fromIndex);
  if (index < 0)
    throw distributionFailure(
      'INVALID_CATALOG',
      'A bundled template is missing a required marker.',
      { path: template },
    );
  return index;
}

export function replaceExact(
  source: string,
  target: string,
  replacement: string,
  template: string,
): string {
  const index = requireIndex(source, target, template);
  return (
    source.slice(0, index) + replacement + source.slice(index + target.length)
  );
}

export function removeBetween(
  source: string,
  startMarker: string,
  endMarker: string,
  template: string,
): string {
  const start = requireIndex(source, startMarker, template);
  const end = requireIndex(source, endMarker, template, start);
  return source.slice(0, start) + source.slice(end);
}

export function sliceFrom(
  source: string,
  marker: string,
  template: string,
): string {
  return source.slice(requireIndex(source, marker, template));
}

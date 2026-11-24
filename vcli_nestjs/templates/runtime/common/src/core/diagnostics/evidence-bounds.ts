/** Shared by configuration validation and the retained-evidence reader. */
export const evidenceByteBounds = {
  minimum: 512,
  maximum: 10485760,
  fallback: 1048576,
} as const;
export const evidenceFileBounds = {
  minimum: 1,
  maximum: 10,
  fallback: 3,
} as const;
export const evidenceAgeBounds = { minimum: 1000, maximum: 604800000 } as const;

export function validEvidenceLimits(config: {
  maxBytes: number;
  maxFiles: number;
  maxAgeMs?: number;
}): boolean {
  const { maxBytes, maxFiles, maxAgeMs } = config;
  return (
    Number.isSafeInteger(maxBytes) &&
    maxBytes >= evidenceByteBounds.minimum &&
    maxBytes <= evidenceByteBounds.maximum &&
    Number.isSafeInteger(maxFiles) &&
    maxFiles >= evidenceFileBounds.minimum &&
    maxFiles <= evidenceFileBounds.maximum &&
    (maxAgeMs === undefined ||
      (Number.isSafeInteger(maxAgeMs) &&
        maxAgeMs >= evidenceAgeBounds.minimum &&
        maxAgeMs <= evidenceAgeBounds.maximum))
  );
}

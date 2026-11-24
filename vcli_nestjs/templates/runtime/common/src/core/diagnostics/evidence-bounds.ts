/** Shared by configuration validation and the retained-evidence reader. */
export const evidenceByteBounds = {
  minimum: 512,
  maximum: 10485760,
  fallback: 1048576,
} as const;

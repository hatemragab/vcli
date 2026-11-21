/** Keep this aligned with templates/runtime/common/src/core/diagnostics/evidence-bounds.ts. */
export const evidenceByteBounds = {
  minimum: 512,
  maximum: 10485760,
  fallback: 1048576,
} as const;

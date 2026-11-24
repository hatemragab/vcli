import { isIP } from 'node:net';
import { z } from 'zod';
import { diagnosticGrantSchema } from './diagnostic-access.js';
import { diagnosticSourceSchema } from '../../core/diagnostics/source-contracts.js';

/** Literal destination prevents DNS/proxy rebinding; HTTPS uses normal certificate validation. */
export const remoteDiagnosticProfileSchema = z.strictObject({
  profile: z.literal('restricted-remote-read'),
  endpoint: z
    .string()
    .max(512)
    .superRefine((input, context) => {
      try {
        const endpoint = new URL(input);
        const address = endpoint.hostname.replace(/^\[|\]$/g, '');
        if (
          !isIP(address) ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash ||
          input.includes('?') ||
          input.includes('#') ||
          endpoint.pathname !== '/v1/diagnostics/query' ||
          (endpoint.protocol !== 'https:' &&
            !(
              endpoint.protocol === 'http:' &&
              (address === '127.0.0.1' || address === '::1')
            )) ||
          endpoint.href !== input
        )
          throw new Error();
      } catch {
        context.addIssue({ code: 'custom', message: 'ENDPOINT_DENIED' });
      }
    }),
  readToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  grant: diagnosticGrantSchema,
  timeoutMs: z.number().int().min(50).max(5000).default(2000),
});
export type RemoteDiagnosticProfile = z.infer<
  typeof remoteDiagnosticProfileSchema
>;
export type RemoteDiagnosticProfileInput = z.input<
  typeof remoteDiagnosticProfileSchema
>;
export const remoteDiagnosticServerProfileSchema = z.strictObject({
  profile: z.literal('restricted-remote-read-backend'),
  listenPort: z.number().int().min(1024).max(65535),
  readToken: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  grant: diagnosticGrantSchema,
  sources: z
    .array(diagnosticSourceSchema)
    .min(1)
    .max(5)
    .refine((sources) => new Set(sources).size === sources.length),
  evidence: z.strictObject({
    directory: z.string().min(1).max(4096),
    maxBytes: z.number().int().min(512).max(10485760),
    maxFiles: z.number().int().min(1).max(10),
    maxAgeMs: z.number().int().min(1000).max(604800000).optional(),
  }),
});

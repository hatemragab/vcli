import { z } from 'zod';
import {
  diagnosticErrorCodes,
  diagnosticRoutes,
} from './diagnostic-catalog.js';

/** Approved event facts only; unknown fields are stripped before any destination. */
export const diagnosticInputSchema = z.object({
  event: z.enum([
    'application.starting',
    'application.started',
    'application.stopping',
    'application.stopped',
    'application.start-failed',
    'application.shutdown-failed',
    'application.start-cleanup-failed',
    'framework.log',
    'http.completed',
    'http.failed',
    'realtime.admitted',
    'realtime.denied',
    'realtime.dropped',
    'operation.completed',
    'operation.failed',
    'job.started',
    'job.completed',
    'job.failed',
    'database.completed',
    'database.failed',
    'infrastructure.sampled',
    'source.status',
    'test.result',
  ]),
  severity: z.enum(['debug', 'info', 'warn', 'error']),
  source: z
    .enum(['application', 'workers', 'database', 'infrastructure', 'tests'])
    .optional(),
  stage: z
    .enum(['config', 'database', 'schema', 'modules', 'listen'])
    .optional(),
  parseStatus: z.enum(['validated', 'rejected']).optional(),
  job: z
    .enum([
      'mail-dispatch',
      'identity-cleanup',
      'media-cleanup',
      'push-delivery',
      'maintenance',
      'diagnostic-check',
    ])
    .optional(),
  database: z.enum(['mongodb', 'postgres']).optional(),
  databaseOperation: z
    .enum(['connect', 'transaction', 'read', 'write', 'schema', 'close'])
    .optional(),
  infrastructure: z
    .object({
      component: z.literal('node-process'),
      rssBytes: z.number().int().nonnegative().max(1099511627776),
      heapUsedBytes: z.number().int().nonnegative().max(1099511627776),
      uptimeSeconds: z.number().nonnegative().max(315360000),
    })
    .optional(),
  dropped: z.number().int().nonnegative().max(1000000).optional(),
  malformed: z.number().int().nonnegative().max(1000000).optional(),
  testResult: z
    .object({
      revision: z
        .string()
        .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
        .optional(),
      dirty: z.boolean().optional(),
      capabilities: z
        .array(
          z.enum([
            'foundation.nest',
            'database.mongodb',
            'database.postgres',
            'auth.local',
            'auth.firebase',
            'mail.capture',
            'mail.smtp',
            'storage.local',
            'storage.aws-s3',
            'storage.r2',
            'media.private',
            'push.fcm',
            'push.apns',
            'realtime.socket-io',
            'realtime.native-ws',
            'realtime.centrifugo',
            'diagnostics.local',
            'diagnostics.restricted-remote-read',
            'deployment.dokploy',
            'deployment.coolify',
            'deployment.caprover',
          ]),
        )
        .max(16)
        .optional(),
      versions: z
        .object({
          node: z
            .string()
            .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)
            .optional(),
          database: z
            .string()
            .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)
            .optional(),
          vector: z
            .string()
            .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)
            .optional(),
          logdy: z
            .string()
            .regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)
            .optional(),
        })
        .optional(),
      outcome: z.enum(['passed', 'failed', 'aborted']),
      logsComplete: z.boolean(),
      cleanupComplete: z.boolean(),
      assertions: z
        .array(
          z.object({
            check: z.enum([
              'exit-code',
              'http-status',
              'persistence',
              'authorization',
              'redaction',
              'protocol',
              'invariant',
              'custom',
            ]),
            ordinal: z.number().int().min(0).max(10000),
            outcome: z.enum(['passed', 'failed', 'skipped']),
            code: z.enum([
              'MATCH',
              'MISMATCH',
              'ASSERTION_FAILED',
              'EXECUTION_ABORTED',
              'INVALID_REPORT',
              'NOT_OBSERVED',
            ]),
          }),
        )
        .max(8),
      artifacts: z
        .array(
          z.object({
            kind: z.enum([
              'screenshot',
              'http-transcript',
              'assertion-report',
              'provider-receipt',
            ]),
            bytes: z.number().int().nonnegative().max(10485760),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .max(4),
    })
    .optional(),
  requestId: z.uuid().optional(),
  operationId: z.uuid().optional(),
  runId: z.uuid().optional(),
  errorCode: z.enum(diagnosticErrorCodes).optional(),
  count: z.number().int().nonnegative().max(1000000).optional(),
  durationMs: z.number().nonnegative().max(86400000).optional(),
  method: z
    .enum([
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
      'CONNECT',
      'TRACE',
    ])
    .optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  route: z.enum(diagnosticRoutes).optional(),
});

export const diagnosticContextSchema = diagnosticInputSchema.pick({
  requestId: true,
  operationId: true,
  runId: true,
});

export type DiagnosticContext = Readonly<
  z.infer<typeof diagnosticContextSchema>
>;

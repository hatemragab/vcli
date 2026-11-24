import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import { authorizeQuery } from './diagnostic-access.js';
import type {
  DiagnosticPage,
  DiagnosticReader,
  DiagnosticStatus,
} from './diagnostic-reader.js';
import {
  diagnosticRecordSchema,
  logFilterSchema,
} from './diagnostic-schema.js';
import { testResultQuerySchema } from './test-result-schema.js';
import {
  remoteDiagnosticProfileSchema,
  type RemoteDiagnosticProfile,
  type RemoteDiagnosticProfileInput,
} from './remote-diagnostic-profile.js';
import { diagnosticSourceSchema } from '../../core/diagnostics/source-contracts.js';

const unavailableSchema = z.union([
  diagnosticSourceSchema,
  z.literal('vector-live-feed-not-observed'),
]);
const gapSchema = z
  .string()
  .regex(
    /^(retention-before-snapshot-unknown|writer-overflow-or-crash-loss-not-measured|oversized-or-incomplete-record|malformed-record|foreign-scope-record|expired-evidence|(application|workers|database|infrastructure|tests):(parse-rejected|writer-dropped|writer-malformed))$/,
  );

const pageSchema = z.object({
  events: z.array(diagnosticRecordSchema).max(100),
  cursor: z.string().max(16384).optional(),
  truncated: z.boolean(),
  coverage: z.object({
    sources: z.array(z.string().max(64)).max(5),
    unavailableSources: z.array(z.string().max(64)).max(10),
    gaps: z.array(z.string().max(128)).max(32),
    scannedBytes: z.number().int().min(0).max(2097152),
    ingestionDelayMs: z.number().nonnegative().nullable(),
    latestEventAgeMs: z.number().nonnegative().nullable(),
    retention: z.string().max(256),
    sourceCoverage: z
      .array(
        z.object({
          source: z.string().max(32),
          parsed: z.number().int().nonnegative(),
          rejected: z.number().int().nonnegative(),
          firstTimestamp: z.iso.datetime().nullable(),
          lastTimestamp: z.iso.datetime().nullable(),
        }),
      )
      .max(5)
      .optional(),
  }),
});
const statusSchema = z.object({
  scope: z.object({
    project: z.literal('generated-api'),
    environment: z.enum(['development', 'test', 'production']),
  }),
  retainedFiles: z.number().int().nonnegative().max(50),
  retainedBytes: z.number().int().nonnegative().max(524288000),
  sources: z.array(z.string().max(64)).max(5),
  unavailableSources: z.array(z.string().max(64)).max(10),
  trust: z.string().max(128),
});
/** No dotenv, proxy variables, operator credentials, DNS lookup or redirect following. */
export class RemoteDiagnosticReader implements DiagnosticReader {
  private readonly profile: RemoteDiagnosticProfile;
  private active = 0;
  constructor(profile: RemoteDiagnosticProfileInput) {
    this.profile = remoteDiagnosticProfileSchema.parse(profile);
  }
  async search(input: unknown): Promise<DiagnosticPage> {
    const parsed = logFilterSchema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
    authorizeQuery(this.profile.grant, parsed.data);
    const validated = pageSchema.safeParse(
      await this.query('logs.search', parsed.data),
    );
    if (!validated.success)
      throw new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503);
    const page = validated.data;
    if (
      !page.coverage.sources.every(
        (value) => diagnosticSourceSchema.safeParse(value).success,
      ) ||
      !page.coverage.unavailableSources.every(
        (value) => unavailableSchema.safeParse(value).success,
      ) ||
      !page.coverage.gaps.every(
        (value) => gapSchema.safeParse(value).success,
      ) ||
      (page.coverage.sourceCoverage &&
        !page.coverage.sourceCoverage.every(
          (value) => diagnosticSourceSchema.safeParse(value.source).success,
        ))
    )
      throw new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503);
    const run = this.profile.grant.runs.find(
      (value) => value.runId === parsed.data.runId,
    )!;
    if (
      !page.events.every(
        (event) =>
          event.environment === this.profile.grant.environment &&
          event.runId === run.runId &&
          !!event.operationId &&
          run.operationIds.includes(event.operationId) &&
          (!parsed.data.operationId ||
            event.operationId === parsed.data.operationId),
      )
    )
      throw new ApplicationError('DIAGNOSTIC_SCOPE_DENIED', 403);
    return {
      ...page,
      coverage: {
        ...page.coverage,
        retention:
          'remote bounded backend policy; unavailable history is not evidence of absence',
      },
    };
  }
  async getTestResult(input: unknown): Promise<DiagnosticPage> {
    const parsed = testResultQuerySchema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
    return this.search({
      ...parsed.data,
      event: 'test.result',
      source: 'tests',
      limit: 100,
    });
  }
  async status(): Promise<DiagnosticStatus> {
    const parsed = statusSchema.safeParse(
      await this.query('diagnostics.status', {}),
    );
    if (!parsed.success)
      throw new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503);
    const value = parsed.data;
    if (
      !value.sources.every(
        (source) => diagnosticSourceSchema.safeParse(source).success,
      ) ||
      !value.unavailableSources.every(
        (source) => unavailableSchema.safeParse(source).success,
      )
    )
      throw new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503);
    if (
      value.scope.project !== this.profile.grant.project ||
      value.scope.environment !== this.profile.grant.environment
    )
      throw new ApplicationError('DIAGNOSTIC_SCOPE_DENIED', 403);
    return {
      ...value,
      retainedFiles: 0,
      retainedBytes: 0,
      trust: 'restricted-remote-read-not-a-sandbox',
    };
  }
  private async query(tool: string, input: unknown): Promise<unknown> {
    if (this.active >= 2) throw new ApplicationError('DIAGNOSTICS_BUSY', 429);
    this.active++;
    try {
      const body = JSON.stringify({
        project: this.profile.grant.project,
        environment: this.profile.grant.environment,
        tool,
        input,
      });
      return await new Promise<unknown>((resolve, reject) => {
        const endpoint = new URL(this.profile.endpoint);
        const requestOptions: RequestOptions = {
          method: 'POST',
          agent: false,
          maxHeaderSize: 8192,
          rejectUnauthorized: true,
          headers: {
            authorization: `Bearer ${this.profile.readToken}`,
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        };
        const request = (
          endpoint.protocol === 'https:' ? httpsRequest : httpRequest
        )(endpoint, requestOptions, (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 262144) {
              response.destroy();
              reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503));
            } else chunks.push(chunk);
          });
          response.once('aborted', () =>
            reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503)),
          );
          response.once('error', () =>
            reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503)),
          );
          response.once('end', () => {
            try {
              if (response.statusCode !== 200)
                throw new ApplicationError(
                  response.statusCode === 401 || response.statusCode === 403
                    ? 'DIAGNOSTIC_SCOPE_DENIED'
                    : 'DIAGNOSTICS_UNAVAILABLE',
                  response.statusCode === 401 || response.statusCode === 403
                    ? 403
                    : 503,
                );
              const result = z
                .strictObject({ value: z.unknown() })
                .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
              resolve(result.value);
            } catch (error) {
              reject(
                error instanceof ApplicationError
                  ? error
                  : new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503),
              );
            }
          });
        });
        const timer = setTimeout(
          () => request.destroy(new Error('REMOTE_TIMEOUT')),
          this.profile.timeoutMs,
        );
        request.once('close', () => clearTimeout(timer));
        request.once('error', () =>
          reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503)),
        );
        request.end(body);
      });
    } finally {
      this.active--;
    }
  }
}

import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  authorizeQuery,
  diagnosticGrantSchema,
  permitsEvent,
  type DiagnosticGrant,
} from './diagnostic-access.js';
import type { DiagnosticReader } from './diagnostic-reader.js';
import {
  diagnosticQueries,
  diagnosticToolSchema,
  executeDiagnosticQuery,
} from './diagnostic-query.js';

const requestSchema = z.strictObject({
  project: z.literal('generated-api'),
  environment: z.enum(['development', 'test', 'production']),
  tool: diagnosticToolSchema,
  input: z.unknown(),
});
/** Restricted query endpoint only. Root owns binding/TLS and the dedicated read credential. */
export class RemoteDiagnosticServer {
  private readonly tokenHash: Buffer;
  private active = 0;
  constructor(
    private readonly reader: DiagnosticReader,
    readToken: string,
    private readonly grant: DiagnosticGrant,
  ) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(readToken))
      throw new Error('INVALID_READ_TOKEN');
    diagnosticGrantSchema.parse(grant);
    this.tokenHash = createHash('sha256').update(readToken).digest();
  }
  createHttpServer(): Server {
    return createServer(
      { maxHeaderSize: 8192, requestTimeout: 2500, headersTimeout: 2500 },
      async (request, response) => {
        const send = (status: number, value: unknown) => {
          if (!response.destroyed) {
            response.writeHead(status, {
              'content-type': 'application/json',
              'cache-control': 'no-store',
              connection: 'close',
            });
            response.end(JSON.stringify(value));
          }
        };
        if (
          request.url !== '/v1/diagnostics/query' ||
          request.method !== 'POST'
        ) {
          send(404, { error: 'DIAGNOSTIC_ENDPOINT_DENIED' });
          return;
        }
        const header = request.headers.authorization ?? '';
        const supplied = createHash('sha256')
          .update(header.startsWith('Bearer ') ? header.slice(7) : '')
          .digest();
        if (!timingSafeEqual(this.tokenHash, supplied)) {
          send(401, { error: 'DIAGNOSTIC_SCOPE_DENIED' });
          return;
        }
        if (this.active >= 2) {
          send(429, { error: 'DIAGNOSTICS_BUSY' });
          return;
        }
        this.active++;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const body = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            timer = setTimeout(() => {
              reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503));
              request.destroy();
            }, 2000);
            request.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > 32768) {
                reject(new ApplicationError('INVALID_DIAGNOSTIC_FILTER'));
                request.destroy();
              } else chunks.push(chunk);
            });
            request.once('end', () => resolve(Buffer.concat(chunks)));
            request.once('error', () =>
              reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503)),
            );
            request.once('aborted', () =>
              reject(new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503)),
            );
          });
          clearTimeout(timer);
          const parsed = requestSchema.safeParse(
            JSON.parse(body.toString('utf8')),
          );
          if (!parsed.success)
            throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
          const query = parsed.data;
          if (
            query.project !== this.grant.project ||
            query.environment !== this.grant.environment
          )
            throw new ApplicationError('DIAGNOSTIC_SCOPE_DENIED', 403);
          const specification = diagnosticQueries.find(
            (value) => value.name === query.tool,
          )!;
          const input = specification.schema.safeParse(query.input);
          if (!input.success)
            throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
          if (
            ['logs.search', 'operations.timeline', 'tests.getResult'].includes(
              query.tool,
            )
          )
            authorizeQuery(this.grant, input.data);
          let workTimer: ReturnType<typeof setTimeout> | undefined;
          let value: unknown;
          try {
            value = await Promise.race([
              executeDiagnosticQuery(this.reader, query.tool, input.data),
              new Promise<never>((_resolve, reject) => {
                workTimer = setTimeout(
                  () =>
                    reject(
                      new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503),
                    ),
                  2000,
                );
              }),
            ]);
          } finally {
            clearTimeout(workTimer);
          }
          if (
            value &&
            typeof value === 'object' &&
            'events' in value &&
            Array.isArray(value.events)
          ) {
            if (
              !value.events.every(
                (event) =>
                  event &&
                  typeof event === 'object' &&
                  event.project === this.grant.project &&
                  event.environment === this.grant.environment &&
                  permitsEvent(this.grant, event),
              )
            )
              throw new ApplicationError('DIAGNOSTIC_SCOPE_DENIED', 403);
          }
          if (
            query.tool === 'diagnostics.status' &&
            value &&
            typeof value === 'object'
          )
            value = {
              ...value,
              retainedFiles: 0,
              retainedBytes: 0,
              trust: 'restricted-remote-read-not-a-sandbox',
            };
          if (query.tool === 'project.describe')
            value = {
              scope: {
                project: this.grant.project,
                environment: this.grant.environment,
              },
              trust: 'restricted-remote-read-not-a-sandbox',
              evidence: 'untrusted-data',
              mutation: 'unavailable',
            };
          if (Buffer.byteLength(JSON.stringify(value)) > 262144)
            throw new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503);
          send(200, { value });
        } catch (error) {
          send(error instanceof ApplicationError ? error.status : 400, {
            error:
              error instanceof ApplicationError
                ? error.code
                : 'INVALID_DIAGNOSTIC_FILTER',
          });
        } finally {
          clearTimeout(timer);
          this.active--;
        }
      },
    );
  }
}

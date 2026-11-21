import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppLoggerService } from '../logging/app-logger.service.js';
import { diagnosticInputSchema } from '../logging/log-event-schema.js';
import { requestFacts } from './http-diagnostic-facts.js';

const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function recordRequest(logger: AppLoggerService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const supplied = diagnosticInputSchema.shape.requestId.safeParse(
      request.headers['x-request-id'],
    );
    const requestId =
      supplied.success && supplied.data ? supplied.data : randomUUID();
    const operationId = mutations.has(request.method)
      ? randomUUID()
      : undefined;
    const context = { requestId, ...(operationId ? { operationId } : {}) };
    response.setHeader('X-Request-Id', requestId);
    if (operationId) response.setHeader('X-Operation-Id', operationId);
    const started = performance.now();
    let completed = false;
    const record = (aborted: boolean): void => {
      if (completed) return;
      completed = true;
      // A closed connection without a finished response has no HTTP outcome.
      const statusCode = aborted ? 499 : response.statusCode;
      const severity =
        statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
      logger.runWithContext(context, () => {
        const errorCode = diagnosticInputSchema.shape.errorCode.safeParse(
          response.locals.diagnosticErrorCode,
        );
        const facts = {
          ...requestFacts(request),
          statusCode,
          durationMs: Math.min(
            86400000,
            Math.round(performance.now() - started),
          ),
          ...(errorCode.success && errorCode.data
            ? { errorCode: errorCode.data }
            : {}),
          ...(aborted ? { errorCode: 'REQUEST_ABORTED' as const } : {}),
        };
        logger.record({ event: 'http.completed', severity, ...facts });
        if (operationId)
          logger.record({
            event:
              statusCode < 400 ? 'operation.completed' : 'operation.failed',
            severity,
            ...facts,
          });
      });
    };
    response.once('finish', () => record(false));
    response.once('close', () => record(!response.writableFinished));
    logger.runWithContext(context, next);
  };
}

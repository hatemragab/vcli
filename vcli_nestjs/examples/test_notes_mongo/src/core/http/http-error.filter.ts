import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApplicationError } from '../errors/application-error.js';
import type { AppLoggerService } from '../logging/app-logger.service.js';
import { diagnosticInputSchema as logEventSchema } from '../logging/log-event-schema.js';
import { requestFacts } from './http-diagnostic-facts.js';
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof ApplicationError
        ? error.status
        : error instanceof HttpException
          ? error.getStatus()
          : 500;
    const code =
      error instanceof ApplicationError
        ? error.code
        : status === 404
          ? 'NOT_FOUND'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status < 500
              ? 'INVALID_REQUEST'
              : 'INTERNAL_ERROR';
    const diagnosticCode = logEventSchema.shape.errorCode.safeParse(code);
    const safeCode =
      diagnosticCode.success && diagnosticCode.data
        ? diagnosticCode.data
        : status >= 500
          ? 'INTERNAL_ERROR'
          : 'INVALID_REQUEST';
    response.locals.diagnosticErrorCode = safeCode;
    this.logger.record({
      event: 'http.failed',
      severity: status >= 500 ? 'error' : 'warn',
      ...requestFacts(request),
      statusCode: status,
      errorCode: safeCode,
    });
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.status(status).json({ error: { code } });
  }
}

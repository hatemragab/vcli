import { Module } from '@nestjs/common';
import { bootstrapBinding } from '../bootstrap/bootstrap-bindings.js';
import { DIAGNOSTIC_EVENTS } from '../diagnostics/diagnostic-events.js';
import { AppLoggerService } from './app-logger.service.js';

const logger = bootstrapBinding<AppLoggerService>(AppLoggerService);
export const bindLogger = logger.bind;

@Module({
  providers: [
    logger.provider,
    { provide: DIAGNOSTIC_EVENTS, useExisting: AppLoggerService },
  ],
  exports: [AppLoggerService, DIAGNOSTIC_EVENTS],
})
export class LoggingModule {}

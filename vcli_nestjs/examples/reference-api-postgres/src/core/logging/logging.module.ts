import { Module, type DynamicModule } from '@nestjs/common';
import { DIAGNOSTIC_EVENTS } from '../diagnostics/diagnostic-events.js';
import { AppLoggerService } from './app-logger.service.js';

@Module({})
export class LoggingModule {
  static register(logger: AppLoggerService): DynamicModule {
    return {
      module: LoggingModule,
      providers: [
        { provide: AppLoggerService, useValue: logger },
        { provide: DIAGNOSTIC_EVENTS, useExisting: AppLoggerService },
      ],
      exports: [AppLoggerService, DIAGNOSTIC_EVENTS],
    };
  }
}

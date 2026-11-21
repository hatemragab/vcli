import { AppLoggerService } from '../logging/app-logger.service.js';
import type { DiagnosticEventInput } from './diagnostic-events.js';

/** Compose outside the native driver's retry loop; no statements or errors enter this API. */
export class DatabaseDiagnosticsService {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly database: NonNullable<DiagnosticEventInput['database']>,
  ) {}
  async observe<T>(
    databaseOperation: NonNullable<DiagnosticEventInput['databaseOperation']>,
    work: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await work();
      this.record(databaseOperation, 'database.completed', start);
      return result;
    } catch (error) {
      this.record(databaseOperation, 'database.failed', start);
      throw error;
    }
  }
  private record(
    databaseOperation: NonNullable<DiagnosticEventInput['databaseOperation']>,
    event: 'database.completed' | 'database.failed',
    start: number,
  ): void {
    try {
      this.logger.record({
        event,
        severity: event === 'database.failed' ? 'warn' : 'debug',
        source: 'database',
        database: this.database,
        databaseOperation,
        durationMs: Math.min(86400000, performance.now() - start),
      });
    } catch {
      /* Preserve the native outcome. */
    }
  }
}

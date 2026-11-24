import { AppLoggerService } from '../logging/app-logger.service.js';
import type { DiagnosticEventInput } from './diagnostic-events.js';

/** Wrap an actual finite job; observations never retry or alter its result. */
export class JobDiagnosticsService {
  constructor(private readonly logger: AppLoggerService) {}
  async run<T>(
    job: NonNullable<DiagnosticEventInput['job']>,
    work: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    this.record({
      event: 'job.started',
      severity: 'info',
      source: 'workers',
      job,
    });
    try {
      const result = await work();
      this.record({
        event: 'job.completed',
        severity: 'info',
        source: 'workers',
        job,
        durationMs: Math.min(86400000, performance.now() - start),
      });
      return result;
    } catch (error) {
      this.record({
        event: 'job.failed',
        severity: 'error',
        source: 'workers',
        job,
        durationMs: Math.min(86400000, performance.now() - start),
      });
      throw error;
    }
  }
  private record(event: DiagnosticEventInput): void {
    try {
      this.logger.record(event);
    } catch {
      /* Observation never changes business behavior. */
    }
  }
}

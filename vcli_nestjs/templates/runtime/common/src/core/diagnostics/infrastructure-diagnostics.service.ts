import { AppLoggerService } from '../logging/app-logger.service.js';

/** Selected process metrics only; no Docker socket, process args, environment or host paths. */
export class InfrastructureDiagnosticsService {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly logger: AppLoggerService) {}
  sample(): void {
    try {
      const memory = process.memoryUsage();
      this.logger.record({
        event: 'infrastructure.sampled',
        severity: 'debug',
        source: 'infrastructure',
        infrastructure: {
          component: 'node-process',
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          uptimeSeconds: Math.min(315360000, process.uptime()),
        },
      });
    } catch {
      /* Metrics cannot fail application work. */
    }
  }
  start(intervalMs = 30000): void {
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 1000 ||
      intervalMs > 300000
    )
      throw new Error('INVALID_SAMPLE_INTERVAL');
    if (this.timer) throw new Error('SAMPLE_ALREADY_STARTED');
    this.sample();
    this.timer = setInterval(() => this.sample(), intervalMs);
    this.timer.unref();
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

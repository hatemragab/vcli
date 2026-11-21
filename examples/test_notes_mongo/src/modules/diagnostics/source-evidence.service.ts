import { join } from 'node:path';
import { mkdir, lstat, chmod } from 'node:fs/promises';
import type { AppConfig } from '../../core/config/app-config.js';
import type {
  DiagnosticEventInput,
  DiagnosticEvents,
} from '../../core/diagnostics/diagnostic-events.js';
import {
  diagnosticSourceSchema,
  eventSource,
  sourceInputSchema,
  type DiagnosticSource,
  type EvidenceConfig,
} from '../../core/diagnostics/source-contracts.js';
import { DiagnosticsService } from './diagnostics.service.js';

/** Independent bounded source queues. Application remains at its original retained path. */
export class SourceEvidenceService implements DiagnosticEvents {
  private closing: Promise<void> | undefined;
  private constructor(
    private readonly writers: ReadonlyMap<DiagnosticSource, DiagnosticsService>,
  ) {}
  static async open(
    config: EvidenceConfig,
    environment: AppConfig['environment'],
    sources: readonly DiagnosticSource[],
  ): Promise<SourceEvidenceService> {
    if (
      !sources.length ||
      sources.length > 5 ||
      new Set(sources).size !== sources.length ||
      !sources.every(
        (source) => diagnosticSourceSchema.safeParse(source).success,
      )
    )
      throw new Error('INVALID_SOURCES');
    const writers = new Map<DiagnosticSource, DiagnosticsService>();
    try {
      await mkdir(config.directory, { recursive: true, mode: 0o700 });
      const root = await lstat(config.directory);
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new Error('UNSAFE_EVIDENCE_DIRECTORY');
      await chmod(config.directory, 0o700);
      for (const source of sources) {
        writers.set(
          source,
          await DiagnosticsService.open(
            {
              ...config,
              directory:
                source === 'application'
                  ? config.directory
                  : join(config.directory, source),
            },
            environment,
            source,
          ),
        );
      }
      return new SourceEvidenceService(writers);
    } catch {
      for (const writer of writers.values()) await writer.close();
      // An unavailable optional destination never disables the independent stdout logger.
      // Construct closed/unavailable destinations without touching any unsafe source path.
      return new SourceEvidenceService(
        new Map(
          sources.map((source) => [
            source,
            new DiagnosticsService(
              {
                ...config,
                directory:
                  source === 'application'
                    ? config.directory
                    : join(config.directory, source),
              },
              environment,
              source,
            ),
          ]),
        ),
      );
    }
  }
  record(input: DiagnosticEventInput): void {
    // The destination writer performs full validation and counts malformed input.
    try {
      const parsed = sourceInputSchema.safeParse(input);
      if (parsed.success)
        this.writers.get(eventSource(parsed.data))?.record(parsed.data);
      else this.writers.get(input.source ?? 'application')?.record(input);
    } catch {
      /* Never throw into business work, even for hostile input objects. */
    }
  }
  status(): Readonly<
    Partial<Record<DiagnosticSource, ReturnType<DiagnosticsService['status']>>>
  > {
    return Object.fromEntries(
      [...this.writers].map(([source, writer]) => [source, writer.status()]),
    );
  }
  async flush(milliseconds = 1000): Promise<boolean> {
    const deadline = performance.now() + Math.max(0, milliseconds);
    // Drain first so an overloaded queue cannot discard its own loss observation.
    const drained = await Promise.all(
      [...this.writers.values()].map((writer) =>
        writer.flush(Math.max(0, deadline - performance.now())),
      ),
    );
    for (const [source, writer] of this.writers) {
      const status = writer.status();
      writer.record({
        event: 'source.status',
        severity: status.available ? 'info' : 'warn',
        source,
        dropped: Math.min(1000000, status.dropped),
        malformed: Math.min(1000000, status.malformed),
        parseStatus: status.malformed ? 'rejected' : 'validated',
      });
    }
    return (
      (
        await Promise.all(
          [...this.writers.values()].map((writer) =>
            writer.flush(Math.max(0, deadline - performance.now())),
          ),
        )
      ).every(Boolean) && drained.every(Boolean)
    );
  }
  close(): Promise<void> {
    return (this.closing ??= (async () => {
      await this.flush();
      await Promise.all(
        [...this.writers.values()].map((writer) => writer.close()),
      );
    })());
  }
}

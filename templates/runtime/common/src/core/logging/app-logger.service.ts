import { Injectable, type LoggerService } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config/app-config.js';
import type {
  DiagnosticEventInput,
  DiagnosticEvents,
} from '../diagnostics/diagnostic-events.js';
import {
  diagnosticContextSchema,
  diagnosticInputSchema,
  type DiagnosticContext,
} from './log-event-schema.js';

/** One safe application entry point for stdout and bounded retained evidence. */
@Injectable()
export class AppLoggerService implements LoggerService, DiagnosticEvents {
  private readonly context = new AsyncLocalStorage<DiagnosticContext>();
  private readonly logger: Logger;
  private malformed = 0;
  private stdoutFailures = 0;
  private stdoutDropped = 0;
  private sinkFailures = 0;

  constructor(
    environment: AppConfig['environment'],
    private readonly sink?: DiagnosticEvents,
    destination?: DestinationStream,
  ) {
    const output = destination ?? this.stdout();
    this.logger = pino(
      {
        level: 'debug',
        base: {
          version: 1,
          project: 'generated-api',
          service: 'generated-api',
          environment,
        },
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        formatters: { level: (severity) => ({ severity }) },
      },
      output,
    );
  }

  record(input: DiagnosticEventInput): void {
    let facts: DiagnosticEventInput;
    try {
      const parsed = diagnosticInputSchema.safeParse({
        ...this.context.getStore(),
        ...input,
      });
      if (!parsed.success) {
        this.malformed++;
        return;
      }
      facts = parsed.data;
    } catch {
      this.malformed++;
      return;
    }
    try {
      const { severity, ...fields } = facts;
      this.logger[severity](fields);
    } catch {
      this.stdoutFailures++;
    }
    try {
      this.sink?.record(facts);
    } catch {
      this.sinkFailures++;
    }
  }

  runWithContext<T>(context: DiagnosticContext, callback: () => T): T {
    let approved: DiagnosticContext = {};
    try {
      const parsed = diagnosticContextSchema.safeParse(context);
      if (parsed.success) approved = parsed.data;
    } catch {
      // Invalid context must not prevent the business callback from running.
    }
    return this.context.run(
      { ...this.context.getStore(), ...approved },
      callback,
    );
  }

  info(input: Omit<DiagnosticEventInput, 'severity'>): void {
    this.framework(input, 'info');
  }

  log(message: unknown, ..._optionalParams: unknown[]): void {
    this.framework(message, 'info');
  }

  error(message: unknown, ..._optionalParams: unknown[]): void {
    this.framework(message, 'error');
  }

  warn(message: unknown, ..._optionalParams: unknown[]): void {
    this.framework(message, 'warn');
  }

  debug(message: unknown, ..._optionalParams: unknown[]): void {
    this.framework(message, 'debug');
  }

  verbose(message: unknown, ..._optionalParams: unknown[]): void {
    this.framework(message, 'debug');
  }

  fatal(message: unknown, ..._optionalParams: unknown[]): void {
    this.framework(message, 'error');
  }

  status(): Readonly<{
    malformed: number;
    stdoutFailures: number;
    stdoutDropped: number;
    sinkFailures: number;
  }> {
    return {
      malformed: this.malformed,
      stdoutFailures: this.stdoutFailures,
      stdoutDropped: this.stdoutDropped,
      sinkFailures: this.sinkFailures,
    };
  }

  async flush(milliseconds = 1000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        new Promise<boolean>((resolve) => {
          try {
            this.logger.flush((error) => resolve(!error));
          } catch {
            resolve(false);
          }
        }),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private framework(
    message: unknown,
    severity: DiagnosticEventInput['severity'],
  ): void {
    // Nest may pass formatted messages, error objects, stacks and arbitrary
    // optional parameters. Only a validated structured event may retain fields.
    try {
      if (message && typeof message === 'object') {
        const parsed = diagnosticInputSchema.safeParse({
          ...message,
          severity,
        });
        if (parsed.success) {
          this.record(parsed.data);
          return;
        }
      }
    } catch {
      // Hostile getters or unsupported objects never reach a destination.
    }
    this.record({ event: 'framework.log', severity });
  }

  private stdout(): DestinationStream {
    // Keep the stdout destination bounded too; a stalled consumer can drop
    // operational logs without allocating an unbounded application queue.
    const destination = pino.destination({
      dest: 1,
      sync: false,
      minLength: 0,
      maxLength: 262144,
    });
    destination.on('drop', () => this.stdoutDropped++);
    destination.on('error', () => this.stdoutFailures++);
    return destination;
  }
}

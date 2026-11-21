import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { AppConfig } from '../../core/config/app-config.js';
import type {
  DiagnosticEventInput,
  DiagnosticEvents,
} from '../../core/diagnostics/diagnostic-events.js';
import { diagnosticInputSchema, evidenceName } from './diagnostic-schema.js';

/** One writer per private directory; bounded loss is preferable to business failure. */
@Injectable()
export class DiagnosticsService implements DiagnosticEvents {
  private readonly writerId = randomUUID();
  private sequence = 0;
  private readonly queue: string[] = [];
  private draining: Promise<void> | undefined;
  private file: FileHandle | undefined;
  private lock: FileHandle | undefined;
  private bytes = 0;
  private closed = false;
  private available = false;
  private dropped = 0;
  private malformed = 0;
  private generation = 0;

  constructor(
    private readonly config: AppConfig['diagnostics'],
    private readonly environment: AppConfig['environment'],
  ) {}

  static async open(
    config: AppConfig['diagnostics'],
    environment: AppConfig['environment'],
  ): Promise<DiagnosticsService> {
    const writer = new DiagnosticsService(config, environment);
    try {
      if (
        !Number.isSafeInteger(config.maxBytes) ||
        config.maxBytes < 512 ||
        config.maxBytes > 10485760 ||
        !Number.isSafeInteger(config.maxFiles) ||
        config.maxFiles < 1 ||
        config.maxFiles > 10
      )
        throw new Error('INVALID_EVIDENCE_LIMITS');
      await mkdir(config.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(config.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('UNSAFE_EVIDENCE_DIRECTORY');
      await chmod(config.directory, 0o700);
      writer.lock = await open(
        join(config.directory, 'writer.lock'),
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      await writer.rotate();
      writer.available = true;
    } catch {
      writer.available = false;
    }
    return writer;
  }

  record(input: DiagnosticEventInput): void {
    const parsed = diagnosticInputSchema.safeParse(input); // Unknown fields are discarded, never serialized.
    if (!parsed.success) {
      this.malformed++;
      return;
    }
    if (!this.available || this.closed || this.queue.length >= 128) {
      this.dropped++;
      return;
    }
    const line =
      JSON.stringify({
        ...parsed.data,
        version: 1,
        project: 'reference-api',
        service: 'reference-api',
        environment: this.environment,
        timestamp: new Date().toISOString(),
        writerId: this.writerId,
        sequence: ++this.sequence,
      }) + '\n';
    if (Buffer.byteLength(line) > Math.min(2048, this.config.maxBytes)) {
      this.dropped++;
      return;
    }
    this.queue.push(line);
    if (!this.draining)
      this.draining = this.drain().finally(() => {
        this.draining = undefined;
      });
  }

  status(): {
    available: boolean;
    dropped: number;
    malformed: number;
    queued: number;
  } {
    return {
      available: this.available,
      dropped: this.dropped,
      malformed: this.malformed,
      queued: this.queue.length,
    };
  }

  async flush(milliseconds = 1000): Promise<boolean> {
    if (!this.draining) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.draining.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const flushed = await this.flush();
    if (!flushed) {
      this.dropped += this.queue.length;
      this.queue.length = 0;
    }
    await this.file?.close().catch(() => undefined);
    await this.lock?.close().catch(() => undefined);
    if (this.lock)
      await unlink(join(this.config.directory, 'writer.lock')).catch(
        () => undefined,
      );
    this.available = false;
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length) {
        const line = this.queue.shift();
        if (!line) continue;
        const length = Buffer.byteLength(line);
        if (this.bytes + length > this.config.maxBytes) await this.rotate();
        await this.file?.writeFile(line);
        this.bytes += length;
      }
    } catch {
      this.available = false;
      this.dropped += this.queue.length + 1;
      this.queue.length = 0;
    }
  }

  private async rotate(): Promise<void> {
    await this.file?.close();
    const before = (await readdir(this.config.directory))
      .filter((name) => evidenceName.test(name))
      .sort();
    const last = before.at(-1);
    this.generation = Math.max(
      Date.now(),
      this.generation + 1,
      last ? Number(last.slice(7, 20)) + 1 : 0,
    );
    this.file = await open(
      join(
        this.config.directory,
        `events-${this.generation}-${randomUUID()}.jsonl`,
      ),
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_APPEND |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    this.bytes = 0;
    const files = (await readdir(this.config.directory))
      .filter((name) => evidenceName.test(name))
      .sort();
    for (const name of files.slice(
      0,
      Math.max(0, files.length - this.config.maxFiles),
    ))
      await unlink(join(this.config.directory, name));
  }
}

import { Injectable } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../../core/config/app-config.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type {
  DiagnosticPage,
  DiagnosticReader,
  DiagnosticRecord,
  DiagnosticStatus,
} from './diagnostic-reader.js';
import {
  diagnosticRecordSchema,
  evidenceName,
  logFilterSchema,
  type LogFilter,
} from './diagnostic-schema.js';

const fileSchema = z.strictObject({
  name: z.string().regex(evidenceName),
  inode: z.number().int().nonnegative(),
  size: z.number().int().nonnegative().max(10485760),
});
const cursorSchema = z.strictObject({
  version: z.literal(1),
  scope: z.string().length(64),
  expiresAt: z.number().int(),
  files: z.array(fileSchema).max(10),
  index: z.number().int().min(0).max(10),
  offset: z.number().int().min(0).max(10485760),
});
type Cursor = z.infer<typeof cursorSchema>;

/** Fixed operator-configured scope; query arguments cannot select another directory. */
@Injectable()
export class DiagnosticReaderService implements DiagnosticReader {
  private readonly key = randomBytes(32);
  private active = 0;

  constructor(
    private readonly config: AppConfig['diagnostics'],
    private readonly environment: AppConfig['environment'],
  ) {}

  async search(input: unknown): Promise<DiagnosticPage> {
    if (this.active >= 2) throw new ApplicationError('DIAGNOSTICS_BUSY', 429);
    this.active++;
    try {
      return await this.readPage(input);
    } finally {
      this.active--;
    }
  }

  private async readPage(input: unknown): Promise<DiagnosticPage> {
    const parsed = logFilterSchema.safeParse(input);
    if (!parsed.success)
      throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
    const query = parsed.data;
    const filter = { ...query };
    delete filter.cursor;
    const scope = createHash('sha256')
      .update(
        JSON.stringify({
          project: 'reference-api',
          environment: this.environment,
          filter,
        }),
      )
      .digest('hex');
    const cursor = query.cursor
      ? this.decode(query.cursor, scope)
      : await this.snapshot(scope);
    const events: DiagnosticRecord[] = [];
    const gaps = new Set<string>([
      'retention-before-snapshot-unknown',
      'uncollected-sources',
      'writer-overflow-or-crash-loss-not-measured',
    ]);
    let scannedBytes = 0;
    const budget = 2097152;
    for (
      ;
      cursor.index < cursor.files.length &&
      events.length < query.limit &&
      scannedBytes < budget;
    ) {
      const entry = cursor.files[cursor.index];
      if (!entry) break;
      let file;
      try {
        file = await open(
          join(this.config.directory, entry.name),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const stat = await file.stat();
        if (
          !stat.isFile() ||
          stat.ino !== entry.inode ||
          stat.size < entry.size
        )
          throw new ApplicationError('DIAGNOSTIC_CURSOR_EXPIRED', 410);
        const size = Math.min(
          entry.size - cursor.offset,
          budget - scannedBytes,
        );
        const bytes = Buffer.alloc(Math.max(0, size));
        const read = await file.read(bytes, 0, bytes.length, cursor.offset);
        if (read.bytesRead < size)
          throw new ApplicationError('DIAGNOSTIC_CURSOR_EXPIRED', 410);
        let start = 0;
        while (start < bytes.length && events.length < query.limit) {
          const newline = bytes.indexOf(10, start);
          if (
            newline < 0 &&
            cursor.offset + bytes.length < entry.size &&
            bytes.length - start < 4096
          )
            break;
          const end = newline < 0 ? bytes.length : newline + 1;
          const line = bytes.subarray(start, newline < 0 ? end : newline);
          scannedBytes += end - start;
          cursor.offset += end - start;
          start = end;
          if (line.length > 4096 || newline < 0) {
            gaps.add('oversized-or-incomplete-record');
            continue;
          }
          try {
            const record = diagnosticRecordSchema.safeParse(
              JSON.parse(line.toString('utf8')),
            );
            if (!record.success) {
              gaps.add('malformed-record');
              continue;
            }
            if (record.data.environment !== this.environment) {
              gaps.add('foreign-scope-record');
              continue;
            }
            if (this.matches(record.data, query)) events.push(record.data);
          } catch {
            gaps.add('malformed-record');
          }
        }
      } catch (error) {
        if (error instanceof ApplicationError) throw error;
        throw new ApplicationError(
          query.cursor
            ? 'DIAGNOSTIC_CURSOR_EXPIRED'
            : 'DIAGNOSTICS_UNAVAILABLE',
          query.cursor ? 410 : 503,
        );
      } finally {
        await file?.close();
      }
      if (cursor.offset >= entry.size) {
        cursor.index++;
        cursor.offset = 0;
      } else if (scannedBytes >= budget - 4096) break;
    }
    const more = cursor.index < cursor.files.length;
    const newest = events.at(-1);
    return {
      events,
      ...(more ? { cursor: this.encode(cursor) } : {}),
      truncated: more,
      coverage: {
        sources: ['application'],
        unavailableSources: ['database', 'workers', 'infrastructure', 'vector'],
        gaps: [...gaps],
        scannedBytes,
        ingestionDelayMs: null,
        latestEventAgeMs: newest
          ? Math.max(0, Date.now() - Date.parse(newest.timestamp))
          : null,
        retention: `${this.config.maxFiles} files, ${this.config.maxBytes} bytes each; no time-retention guarantee`,
      },
    };
  }

  async status(): Promise<DiagnosticStatus> {
    if (this.active >= 2) throw new ApplicationError('DIAGNOSTICS_BUSY', 429);
    this.active++;
    try {
      const snapshot = await this.snapshot('0'.repeat(64));
      return {
        scope: { project: 'reference-api', environment: this.environment },
        retainedFiles: snapshot.files.length,
        retainedBytes: snapshot.files.reduce((sum, file) => sum + file.size, 0),
        sources: ['application'],
        unavailableSources: ['database', 'workers', 'infrastructure', 'vector'],
        trust: 'local-same-user-not-a-sandbox',
      };
    } finally {
      this.active--;
    }
  }

  private async snapshot(scope: string): Promise<Cursor> {
    try {
      const root = await lstat(this.config.directory);
      if (!root.isDirectory() || root.isSymbolicLink())
        throw new Error('UNSAFE_DIRECTORY');
      const names = (await readdir(this.config.directory))
        .filter((name) => evidenceName.test(name))
        .sort();
      if (names.length > this.config.maxFiles || names.length > 10)
        throw new Error('EVIDENCE_LIMIT');
      const files: Cursor['files'] = [];
      for (const name of names) {
        const stat = await lstat(join(this.config.directory, name));
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > this.config.maxBytes
        )
          throw new Error('UNSAFE_FILE');
        files.push({ name, inode: stat.ino, size: stat.size });
      }
      return {
        version: 1,
        scope,
        expiresAt: Date.now() + 300000,
        files,
        index: 0,
        offset: 0,
      };
    } catch {
      throw new ApplicationError('DIAGNOSTICS_UNAVAILABLE', 503);
    }
  }

  private matches(event: DiagnosticRecord, query: LogFilter): boolean {
    return (
      (!query.since ||
        Date.parse(event.timestamp) >= Date.parse(query.since)) &&
      (!query.until ||
        Date.parse(event.timestamp) <= Date.parse(query.until)) &&
      (!query.event || event.event === query.event) &&
      (!query.severity || event.severity === query.severity) &&
      (!query.requestId || event.requestId === query.requestId) &&
      (!query.operationId || event.operationId === query.operationId) &&
      (!query.runId || event.runId === query.runId)
    );
  }
  private encode(cursor: Cursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
    return `${payload}.${createHmac('sha256', this.key).update(payload).digest('base64url')}`;
  }
  private decode(token: string, scope: string): Cursor {
    try {
      const parts = token.split('.');
      const payload = parts[0];
      const signature = parts[1];
      if (parts.length !== 2 || !payload || !signature)
        throw new Error('INVALID_CURSOR');
      const expected = createHmac('sha256', this.key).update(payload).digest();
      const supplied = Buffer.from(signature, 'base64url');
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        throw new Error('INVALID_CURSOR');
      const cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
      );
      if (cursor.scope !== scope || cursor.expiresAt <= Date.now())
        throw new Error('INVALID_CURSOR');
      return cursor;
    } catch {
      throw new ApplicationError('DIAGNOSTIC_CURSOR_EXPIRED', 410);
    }
  }
}

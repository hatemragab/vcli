import { Injectable } from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { listEvidenceFiles } from './evidence-files.js';
import { join } from 'node:path';
import {
  diagnosticSources,
  diagnosticSourceSchema,
  eventSource,
  type DiagnosticSource,
  type EvidenceConfig,
} from '../../core/diagnostics/source-contracts.js';
import {
  authorizeQuery,
  diagnosticGrantSchema,
  grantScope,
  permitsEvent,
  type DiagnosticGrant,
} from './diagnostic-access.js';
import { testResultQuerySchema } from './test-result-schema.js';
import { z } from 'zod';
import type { AppConfig } from '../../core/config/app-config.js';
import { evidenceByteBounds } from '../../core/diagnostics/evidence-bounds.js';
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
  source: diagnosticSourceSchema,
  name: z.string().regex(evidenceName),
  inode: z.number().int().nonnegative(),
  size: z.number().int().nonnegative().max(evidenceByteBounds.maximum),
});
const cursorSchema = z.strictObject({
  version: z.literal(1),
  scope: z.string().length(64),
  expiresAt: z.number().int(),
  files: z.array(fileSchema).max(50),
  unavailable: z.array(diagnosticSourceSchema).max(5),
  index: z.number().int().min(0).max(50),
  offset: z.number().int().min(0).max(10485760),
});
type Cursor = z.infer<typeof cursorSchema>;
/** Fixed operator-configured scope; query arguments cannot select another directory. */
@Injectable()
export class DiagnosticReaderService implements DiagnosticReader {
  private readonly key = randomBytes(32);
  private active = 0;
  constructor(
    private readonly config: EvidenceConfig,
    private readonly environment: AppConfig['environment'],
    private readonly options: Readonly<{
      sources?: readonly DiagnosticSource[];
      grant?: DiagnosticGrant;
    }> = {},
  ) {
    if (options.grant) {
      diagnosticGrantSchema.parse(options.grant);
      if (options.grant.environment !== environment)
        throw new ApplicationError('DIAGNOSTIC_SCOPE_DENIED', 403);
    }
    const sources = options.sources ?? ['application'];
    if (
      !sources.length ||
      sources.length > 5 ||
      new Set(sources).size !== sources.length ||
      !sources.every(
        (source) => diagnosticSourceSchema.safeParse(source).success,
      )
    )
      throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
    if (
      !Number.isInteger(config.maxFiles) ||
      config.maxFiles < 1 ||
      config.maxFiles > 10 ||
      !Number.isInteger(config.maxBytes) ||
      config.maxBytes < evidenceByteBounds.minimum ||
      config.maxBytes > evidenceByteBounds.maximum ||
      (config.maxAgeMs !== undefined &&
        (!Number.isInteger(config.maxAgeMs) ||
          config.maxAgeMs < 1000 ||
          config.maxAgeMs > 604800000))
    )
      throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
  }
  async getTestResult(input: unknown): Promise<DiagnosticPage> {
    const query = testResultQuerySchema.safeParse(input);
    if (!query.success) throw new ApplicationError('INVALID_DIAGNOSTIC_FILTER');
    const page = await this.search({
      ...query.data,
      event: 'test.result',
      source: 'tests',
      limit: 100,
    });
    return page;
  }
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
    authorizeQuery(this.options.grant, query);
    const filter = { ...query };
    delete filter.cursor;
    const scope = createHash('sha256')
      .update(
        JSON.stringify({
          project: 'generated-api',
          environment: this.environment,
          grant: grantScope(this.options.grant),
          sources: this.options.sources ?? ['application'],
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
      'writer-overflow-or-crash-loss-not-measured',
    ]);
    let scannedBytes = 0;
    let resultBytes = 0;
    let resultLimit = false;
    const coverage = new Map<
      DiagnosticSource,
      {
        source: DiagnosticSource;
        parsed: number;
        rejected: number;
        firstTimestamp: string | null;
        lastTimestamp: string | null;
      }
    >();
    for (const source of this.options.sources ?? ['application'])
      coverage.set(source, {
        source,
        parsed: 0,
        rejected: 0,
        firstTimestamp: null,
        lastTimestamp: null,
      });
    const budget = 2097152;
    for (
      ;
      cursor.index < cursor.files.length &&
      !resultLimit &&
      events.length < query.limit &&
      scannedBytes < budget;
    ) {
      const entry = cursor.files[cursor.index];
      if (!entry) break;
      let file;
      try {
        file = await open(
          join(this.directory(entry.source), entry.name),
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
          const sourceCoverage = coverage.get(entry.source)!;
          const consumed = end - start;
          scannedBytes += consumed;
          cursor.offset += consumed;
          start = end;
          if (line.length > 4096 || newline < 0) {
            sourceCoverage.rejected++;
            gaps.add('oversized-or-incomplete-record');
            continue;
          }
          try {
            const record = diagnosticRecordSchema.safeParse(
              JSON.parse(line.toString('utf8')),
            );
            if (!record.success) {
              sourceCoverage.rejected++;
              gaps.add('malformed-record');
              continue;
            }
            if (
              record.data.environment !== this.environment ||
              eventSource(record.data) !== entry.source
            ) {
              sourceCoverage.rejected++;
              gaps.add('foreign-scope-record');
              continue;
            }
            if (!permitsEvent(this.options.grant, record.data)) continue;
            if (
              this.config.maxAgeMs !== undefined &&
              Date.parse(record.data.timestamp) <
                Date.now() - this.config.maxAgeMs
            ) {
              gaps.add('expired-evidence');
              continue;
            }
            sourceCoverage.parsed++;
            if (
              !sourceCoverage.firstTimestamp ||
              record.data.timestamp < sourceCoverage.firstTimestamp
            )
              sourceCoverage.firstTimestamp = record.data.timestamp;
            if (
              !sourceCoverage.lastTimestamp ||
              record.data.timestamp > sourceCoverage.lastTimestamp
            )
              sourceCoverage.lastTimestamp = record.data.timestamp;
            if (record.data.parseStatus === 'rejected')
              gaps.add(`${entry.source}:parse-rejected`);
            if (record.data.dropped) gaps.add(`${entry.source}:writer-dropped`);
            if (record.data.malformed)
              gaps.add(`${entry.source}:writer-malformed`);
            if (this.matches(record.data, query)) {
              const bytes = Buffer.byteLength(JSON.stringify(record.data));
              if (resultBytes + bytes > 196608) {
                cursor.offset -= consumed;
                resultLimit = true;
                break;
              }
              resultBytes += bytes;
              events.push(record.data);
            }
          } catch {
            sourceCoverage.rejected++;
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
    const newest = events.reduce<DiagnosticRecord | undefined>(
      (latest, event) =>
        !latest || event.timestamp > latest.timestamp ? event : latest,
      undefined,
    );
    return {
      events,
      ...(more ? { cursor: this.encode(cursor) } : {}),
      truncated: more,
      coverage: {
        sources: [...(this.options.sources ?? ['application'])].filter(
          (source) => !cursor.unavailable.includes(source),
        ),
        unavailableSources: [
          ...new Set([
            ...diagnosticSources.filter(
              (source) =>
                !(this.options.sources ?? ['application']).includes(source),
            ),
            ...cursor.unavailable,
            'vector-live-feed-not-observed',
          ]),
        ],
        sourceCoverage: [...coverage.values()],
        gaps: [...gaps],
        scannedBytes,
        ingestionDelayMs: null,
        latestEventAgeMs: newest
          ? Math.max(0, Date.now() - Date.parse(newest.timestamp))
          : null,
        retention: `${this.config.maxFiles} files per source, ${this.config.maxBytes} bytes each; ${this.config.maxAgeMs === undefined ? 'no time-retention guarantee' : `${this.config.maxAgeMs}ms query expiry; cleanup on writer rotation/open`}`,
      },
    };
  }
  async status(): Promise<DiagnosticStatus> {
    if (this.active >= 2) throw new ApplicationError('DIAGNOSTICS_BUSY', 429);
    this.active++;
    try {
      const snapshot = await this.snapshot('0'.repeat(64));
      return {
        scope: { project: 'generated-api', environment: this.environment },
        retainedFiles: this.options.grant ? 0 : snapshot.files.length,
        retainedBytes: this.options.grant
          ? 0
          : snapshot.files.reduce((sum, file) => sum + file.size, 0),
        sources: [...(this.options.sources ?? ['application'])].filter(
          (source) => !snapshot.unavailable.includes(source),
        ),
        unavailableSources: [
          ...diagnosticSources.filter(
            (source) =>
              !(this.options.sources ?? ['application']).includes(source),
          ),
          ...snapshot.unavailable,
          'vector-live-feed-not-observed',
        ],
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
      const files: Cursor['files'] = [];
      const unavailable: DiagnosticSource[] = [];
      for (const source of this.options.sources ?? ['application']) {
        const directory = this.directory(source);
        try {
          const directoryStat = await lstat(directory);
          if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
            throw new Error('UNSAFE_SOURCE_DIRECTORY');
          const names = await listEvidenceFiles(directory);
          if (names.length > this.config.maxFiles || names.length > 10)
            throw new Error('EVIDENCE_LIMIT');
          for (const name of names) {
            const stat = await lstat(join(directory, name));
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              stat.size > this.config.maxBytes
            )
              throw new Error('UNSAFE_FILE');
            files.push({ source, name, inode: stat.ino, size: stat.size });
          }
        } catch {
          unavailable.push(source);
        }
      }
      return {
        version: 1,
        scope,
        expiresAt: Date.now() + 300000,
        files,
        unavailable,
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
      (!query.runId || event.runId === query.runId) &&
      (!query.source || eventSource(event) === query.source)
    );
  }
  private directory(source: DiagnosticSource): string {
    return source === 'application'
      ? this.config.directory
      : join(this.config.directory, source);
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

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  appendFile,
  chmod,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DiagnosticsService } from '../dist/modules/diagnostics/diagnostics.service.js';
import { DiagnosticReaderService } from '../dist/modules/diagnostics/diagnostic-reader.service.js';

test('status and search share the reader concurrency limit and release pending slots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reference-evidence-limit-'));
  const reader = new DiagnosticReaderService(
    { directory, maxBytes: 4096, maxFiles: 2 },
    'test',
  );
  try {
    const statuses = [reader.status(), reader.status()];
    await assert.rejects(() => reader.search({}), /DIAGNOSTICS_BUSY/);
    await Promise.all(statuses);
    const searches = [reader.search({}), reader.search({})];
    await assert.rejects(() => reader.status(), /DIAGNOSTICS_BUSY/);
    await Promise.all(searches);
    assert.equal((await reader.status()).retainedFiles, 0);
    await Promise.all(
      Array.from({ length: 2 }, () =>
        assert.rejects(
          () => reader.search({ path: '/etc/passwd' }),
          /INVALID_DIAGNOSTIC_FILTER/,
        ),
      ),
    );
    const afterFailure = await Promise.all([reader.status(), reader.status()]);
    assert.ok(afterFailure.every((status) => status.retainedFiles === 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('allowlisted JSONL excludes sentinels and reader denies paths, executable filters and foreign cursors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reference-evidence-'));
  const config = { directory, maxBytes: 4096, maxFiles: 3 };
  const writer = await DiagnosticsService.open(config, 'test');
  const reader = new DiagnosticReaderService(config, 'test');
  const sentinel = 'private-sentinel-cookie-token-signed-url';
  try {
    const requestId = randomUUID();
    writer.record({
      event: 'http.completed',
      severity: 'info',
      requestId,
      headers: { authorization: sentinel },
      message: `https://private.invalid/?sig=${sentinel}`,
      environment: sentinel,
    } as Parameters<typeof writer.record>[0]);
    writer.record({
      event: 'operation.completed',
      severity: 'info',
      operationId: randomUUID(),
    });
    assert.equal(await writer.flush(), true);
    const files = (await readdir(directory)).filter((file) =>
      file.endsWith('.jsonl'),
    );
    const retained = await readFile(join(directory, files[0]!), 'utf8');
    assert.equal(retained.includes(sentinel), false);
    assert.equal((await stat(join(directory, files[0]!))).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const first = await reader.search({ limit: 1 });
    assert.equal(first.events.length, 1);
    assert.ok(first.cursor);
    const second = await reader.search({ limit: 1, cursor: first.cursor });
    assert.equal(second.events.length, 1);
    assert.notEqual(second.events[0]?.event, first.events[0]?.event);
    await assert.rejects(
      () =>
        reader.search({ limit: 1, cursor: first.cursor, severity: 'error' }),
      /DIAGNOSTIC_CURSOR_EXPIRED/,
    );
    await assert.rejects(
      () =>
        new DiagnosticReaderService(config, 'production').search({
          limit: 1,
          cursor: first.cursor,
        }),
      /DIAGNOSTIC_CURSOR_EXPIRED/,
    );
    await assert.rejects(
      () => reader.search({ path: '../../.env' }),
      /INVALID_DIAGNOSTIC_FILTER/,
    );
    await assert.rejects(
      () => reader.search({ sql: 'DROP TABLE', shell: 'id', project: 'other' }),
      /INVALID_DIAGNOSTIC_FILTER/,
    );
    await assert.rejects(
      () => reader.search({ limit: 101 }),
      /INVALID_DIAGNOSTIC_FILTER/,
    );
    const safe = await reader.search({ requestId });
    assert.equal(safe.events.length, 1);
    assert.equal(JSON.stringify(safe).includes(sentinel), false);
    assert.ok(safe.coverage.gaps.includes('uncollected-sources'));
  } finally {
    await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rotation expires snapshots explicitly, retains bounded files and reports malformed/foreign records', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'reference-evidence-rotation-'),
  );
  const config = { directory, maxBytes: 1024, maxFiles: 2 };
  const writer = await DiagnosticsService.open(config, 'test');
  const reader = new DiagnosticReaderService(config, 'test');
  try {
    for (let i = 0; i < 2; i++)
      writer.record({
        event: 'operation.completed',
        severity: 'info',
        operationId: randomUUID(),
      });
    await writer.flush();
    const page = await reader.search({ limit: 1 });
    assert.ok(page.cursor);
    for (let i = 0; i < 12; i++) {
      writer.record({
        event: 'operation.completed',
        severity: 'info',
        operationId: randomUUID(),
      });
      await writer.flush();
    }
    await assert.rejects(
      () => reader.search({ limit: 1, cursor: page.cursor }),
      /DIAGNOSTIC_CURSOR_EXPIRED/,
    );
    const files = (await readdir(directory))
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
    assert.ok(files.length <= 2);
    for (const file of files)
      assert.ok((await stat(join(directory, file))).size <= 1024);
    await writer.close();
    const last = join(directory, files.at(-1)!);
    const record = JSON.parse(
      (await readFile(last, 'utf8')).trim().split('\n')[0]!,
    );
    // Read-side defense strips injected fields even if an authorized same-user writer tampers.
    await appendFile(
      last,
      JSON.stringify({ ...record, environment: 'production' }) +
        '\n' +
        '{malformed}\n',
    );
    const expandedReader = new DiagnosticReaderService(
      { ...config, maxBytes: 4096 },
      'test',
    );
    const observed = await expandedReader.search({});
    assert.ok(observed.coverage.gaps.includes('foreign-scope-record'));
    assert.ok(observed.coverage.gaps.includes('malformed-record'));
  } finally {
    await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('unavailable directory, queue overflow and writer contention do not throw into business work', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'reference-evidence-failure-'),
  );
  const config = { directory, maxBytes: 4096, maxFiles: 2 };
  const first = await DiagnosticsService.open(config, 'test');
  const second = await DiagnosticsService.open(config, 'test');
  try {
    assert.equal(second.status().available, false);
    assert.doesNotThrow(() =>
      second.record({ event: 'operation.completed', severity: 'info' }),
    );
    assert.equal(second.status().dropped, 1);
    for (let i = 0; i < 500; i++)
      first.record({ event: 'operation.completed', severity: 'info' });
    assert.ok(first.status().queued <= 128);
    assert.ok(first.status().dropped > 0);
    await first.flush();
    const link = join(
      directory,
      'events-9999999999999-00000000-0000-4000-8000-000000000000.jsonl',
    );
    await symlink('/etc/passwd', link);
    await assert.rejects(
      () => new DiagnosticReaderService(config, 'test').search({}),
      /DIAGNOSTICS_UNAVAILABLE/,
    );
    await chmod(directory, 0o700);
  } finally {
    await second.close();
    await first.close();
    await rm(directory, { recursive: true, force: true });
  }
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import type { ArgumentsHost } from '@nestjs/common';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { DiagnosticEventInput } from '../dist/core/diagnostics/diagnostic-events.js';
import { ApplicationError } from '../dist/core/errors/application-error.js';
import { HttpErrorFilter } from '../dist/core/http/http-error.filter.js';
import { recordRequest } from '../dist/core/http/record-request.js';
import { AppLoggerService } from '../dist/core/logging/app-logger.service.js';
import { DiagnosticsService } from '../dist/modules/diagnostics/diagnostics.service.js';

function parseLines(chunks: readonly string[]): Record<string, unknown>[] {
  return chunks
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const value: unknown = JSON.parse(line);
      assert.ok(value && typeof value === 'object' && !Array.isArray(value));
      return value as Record<string, unknown>;
    });
}

function captureLogger() {
  const chunks: string[] = [];
  const events: DiagnosticEventInput[] = [];
  const logger = new AppLoggerService(
    'test',
    { record: (event) => events.push(event) },
    { write: (line) => chunks.push(line) },
  );
  return { logger, chunks, events };
}

test('Pino output and retained evidence preserve approved facts and exclude private input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reference-shared-logging-'));
  const writer = await DiagnosticsService.open(
    { directory, maxBytes: 8192, maxFiles: 2 },
    'test',
  );
  const chunks: string[] = [];
  const logger = new AppLoggerService('test', writer, {
    write: (line) => chunks.push(line),
  });
  const sentinel = 'private-logging-cookie-token-signed-url';
  const facts = {
    event: 'http.completed',
    severity: 'warn',
    requestId: randomUUID(),
    operationId: randomUUID(),
    runId: randomUUID(),
    errorCode: 'NOTE_NOT_FOUND',
    method: 'DELETE',
    statusCode: 404,
    route: '/notes/:id',
    durationMs: 12,
    count: 1,
  } as const;
  try {
    logger.record({
      ...facts,
      message: sentinel,
      headers: { authorization: sentinel },
      body: { password: sentinel },
      error: new Error(sentinel),
      environment: sentinel,
    } as DiagnosticEventInput);
    logger.error(new Error(sentinel), sentinel, { cookie: sentinel });
    logger.log(sentinel);
    logger.warn(sentinel, { token: sentinel });
    assert.equal(await writer.flush(), true);
    const names = (await readdir(directory)).filter((name) =>
      name.endsWith('.jsonl'),
    );
    const retainedText = (
      await Promise.all(
        names.map((name) => readFile(join(directory, name), 'utf8')),
      )
    ).join('');
    const stdout = parseLines(chunks);
    const retained = parseLines([retainedText]);
    assert.equal(stdout.length, 4);
    assert.equal(retained.length, 4);
    for (const [key, value] of Object.entries(facts)) {
      assert.equal(stdout[0]?.[key], value);
      assert.equal(retained[0]?.[key], value);
    }
    for (const event of [...stdout, ...retained]) {
      assert.equal(event.version, 1);
      assert.equal(event.project, 'reference-api');
      assert.equal(event.service, 'reference-api');
      assert.equal(event.environment, 'test');
      assert.equal(typeof event.timestamp, 'string');
      assert.equal(Number.isNaN(Date.parse(String(event.timestamp))), false);
    }
    assert.equal(chunks.join('').includes(sentinel), false);
    assert.equal(retainedText.includes(sentinel), false);
    assert.deepEqual(
      stdout.slice(1).map((event) => [event.event, event.severity]),
      [
        ['framework.log', 'error'],
        ['framework.log', 'info'],
        ['framework.log', 'warn'],
      ],
    );
  } finally {
    await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('concurrent asynchronous contexts remain isolated and invalid identifiers are excluded', async () => {
  const { logger, chunks, events } = captureLogger();
  const first = { requestId: randomUUID(), operationId: randomUUID() };
  const second = { requestId: randomUUID(), runId: randomUUID() };
  await Promise.all([
    logger.runWithContext(first, async () => {
      await delay(15);
      logger.record({ event: 'operation.completed', severity: 'info' });
    }),
    logger.runWithContext(second, async () => {
      await delay(1);
      logger.record({ event: 'operation.failed', severity: 'error' });
    }),
  ]);
  const firstEvent = events.find(
    (event) => event.event === 'operation.completed',
  );
  const secondEvent = events.find(
    (event) => event.event === 'operation.failed',
  );
  assert.equal(firstEvent?.requestId, first.requestId);
  assert.equal(firstEvent?.operationId, first.operationId);
  assert.equal(firstEvent?.runId, undefined);
  assert.equal(secondEvent?.requestId, second.requestId);
  assert.equal(secondEvent?.runId, second.runId);
  assert.equal(secondEvent?.operationId, undefined);
  logger.record({ event: 'application.started', severity: 'info' });
  assert.equal(events.at(-1)?.requestId, undefined);
  const sentinel = 'private-invalid-context';
  assert.doesNotThrow(() =>
    logger.runWithContext(
      { requestId: sentinel, operationId: sentinel, runId: sentinel },
      () => logger.record({ event: 'application.started', severity: 'info' }),
    ),
  );
  assert.equal(chunks.join('').includes(sentinel), false);
  for (const event of events.slice(2)) {
    assert.equal(event.requestId, undefined);
    assert.equal(event.operationId, undefined);
    assert.equal(event.runId, undefined);
  }
});

test('stdout and retained-sink failures are independent and never throw into application work', () => {
  const retained: DiagnosticEventInput[] = [];
  const stdoutFailure = new AppLoggerService(
    'test',
    { record: (event) => retained.push(event) },
    {
      write: () => {
        throw new Error('STDOUT_UNAVAILABLE');
      },
    },
  );
  assert.doesNotThrow(() =>
    stdoutFailure.record({ event: 'application.started', severity: 'info' }),
  );
  assert.equal(retained.length, 1);
  const chunks: string[] = [];
  const retainedFailure = new AppLoggerService(
    'test',
    {
      record: () => {
        throw new Error('EVIDENCE_UNAVAILABLE');
      },
    },
    { write: (line) => chunks.push(line) },
  );
  assert.doesNotThrow(() =>
    retainedFailure.record({ event: 'application.started', severity: 'info' }),
  );
  assert.equal(parseLines(chunks)[0]?.event, 'application.started');
});

function httpHost(
  request: Request,
  response: Response,
  next: NextFunction,
): ArgumentsHost {
  const args = [request, response, next];
  return {
    getArgs: <T extends unknown[]>() => args as unknown as T,
    getArgByIndex: <T>(index: number) => args[index] as T,
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
      getNext: <T>() => next as T,
    }),
    switchToRpc: () => {
      throw new Error('HTTP_ONLY_TEST');
    },
    switchToWs: () => {
      throw new Error('HTTP_ONLY_TEST');
    },
    getType: <T extends string>() => 'http' as T,
  };
}

test('real HTTP requests retain safe errors, terminal operation facts and asynchronous correlation', async () => {
  const { logger, chunks, events } = captureLogger();
  const app = express();
  const filter = new HttpErrorFilter(logger);
  const sentinel = 'private-http-authorization-body-url-error';
  app.use(recordRequest(logger));
  app.use(express.json());
  app.post('/api/notes', async (_request, response) => {
    await delay(15);
    logger.record({ event: 'realtime.admitted', severity: 'info' });
    response.status(201).json({ ok: true });
  });
  app.delete('/api/notes/:id', async () => {
    await delay(1);
    throw new ApplicationError('NOTE_NOT_FOUND', 404, sentinel);
  });
  app.get('/api/notes/:id', async () => {
    await delay(5);
    throw new Error(sentinel);
  });
  app.get('/health/live', (_request, response) => response.json({ ok: true }));
  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      filter.catch(error, httpHost(request, response, next));
    },
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const createdId = randomUUID();
  const missingId = randomUUID();
  const failedId = randomUUID();
  try {
    const [created, missing, failed, health] = await Promise.all([
      fetch(`${base}/api/notes?token=${sentinel}`, {
        method: 'POST',
        headers: {
          authorization: sentinel,
          'content-type': 'application/json',
          'x-request-id': createdId,
          'x-operation-id': sentinel,
        },
        body: JSON.stringify({ password: sentinel }),
      }),
      fetch(`${base}/api/notes/${sentinel}`, {
        method: 'DELETE',
        headers: { 'x-request-id': missingId },
      }),
      fetch(`${base}/api/notes/${sentinel}?secret=${sentinel}`, {
        headers: { 'x-request-id': failedId },
      }),
      fetch(`${base}/health/live`, { headers: { 'x-request-id': sentinel } }),
    ]);
    assert.equal(created.status, 201);
    assert.equal(missing.status, 404);
    assert.equal(failed.status, 500);
    assert.deepEqual(await missing.json(), {
      error: { code: 'NOTE_NOT_FOUND' },
    });
    assert.deepEqual(await failed.json(), {
      error: { code: 'INTERNAL_ERROR' },
    });
    await created.arrayBuffer();
    await health.arrayBuffer();
    assert.equal(created.headers.get('x-request-id'), createdId);
    assert.equal(missing.headers.get('x-request-id'), missingId);
    assert.equal(failed.headers.get('x-request-id'), failedId);
    assert.match(health.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
    assert.match(
      created.headers.get('x-operation-id') ?? '',
      /^[0-9a-f-]{36}$/,
    );
    assert.match(
      missing.headers.get('x-operation-id') ?? '',
      /^[0-9a-f-]{36}$/,
    );
    assert.notEqual(
      created.headers.get('x-operation-id'),
      missing.headers.get('x-operation-id'),
    );
    const completions = events.filter(
      (event) => event.event === 'http.completed',
    );
    assert.equal(completions.length, 4);
    const createCompleted = completions.find(
      (event) => event.requestId === createdId,
    );
    assert.equal(createCompleted?.statusCode, 201);
    assert.equal(createCompleted?.method, 'POST');
    assert.equal(createCompleted?.route, '/notes');
    assert.equal(
      createCompleted?.operationId,
      created.headers.get('x-operation-id'),
    );
    assert.equal(typeof createCompleted?.durationMs, 'number');
    const nested = events.find((event) => event.event === 'realtime.admitted');
    assert.equal(nested?.requestId, createdId);
    assert.equal(nested?.operationId, created.headers.get('x-operation-id'));
    const missingError = events.find(
      (event) => event.event === 'http.failed' && event.requestId === missingId,
    );
    assert.equal(missingError?.errorCode, 'NOTE_NOT_FOUND');
    assert.equal(missingError?.statusCode, 404);
    assert.equal(missingError?.route, '/notes/:id');
    const failedError = events.find(
      (event) => event.event === 'http.failed' && event.requestId === failedId,
    );
    assert.equal(failedError?.errorCode, 'INTERNAL_ERROR');
    assert.equal(failedError?.statusCode, 500);
    assert.equal(failedError?.severity, 'error');
    const terminal = events.filter(
      (event) =>
        event.event === 'operation.completed' ||
        event.event === 'operation.failed',
    );
    assert.equal(terminal.length, 2);
    assert.equal(
      terminal.find((event) => event.requestId === createdId)?.event,
      'operation.completed',
    );
    assert.equal(
      terminal.find((event) => event.requestId === missingId)?.event,
      'operation.failed',
    );
    const malformedId = '11111111-1111-1111-1111-111111111111';
    const replaced = await fetch(`${base}/api/notes`, {
      method: 'POST',
      headers: {
        'x-request-id': malformedId,
        'x-operation-id': malformedId,
      },
    });
    await replaced.arrayBuffer();
    const replacementId = replaced.headers.get('x-request-id');
    const replacementOperationId = replaced.headers.get('x-operation-id');
    assert.ok(replacementId);
    assert.ok(replacementOperationId);
    assert.notEqual(replacementId, malformedId);
    assert.notEqual(replacementOperationId, malformedId);
    const replacedCompletion = events.find(
      (event) =>
        event.event === 'http.completed' && event.requestId === replacementId,
    );
    const replacedNested = events.find(
      (event) =>
        event.event === 'realtime.admitted' &&
        event.requestId === replacementId,
    );
    assert.equal(replacedCompletion?.operationId, replacementOperationId);
    assert.equal(replacedNested?.operationId, replacementOperationId);
    assert.equal(JSON.stringify(events).includes(malformedId), false);
    assert.equal(chunks.join('').includes(sentinel), false);
    assert.equal(JSON.stringify(events).includes(sentinel), false);
    for (const record of parseLines(chunks)) {
      assert.equal(record.environment, 'test');
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test(
  'an aborted mutating request records one terminal completion and operation failure',
  { timeout: 5000 },
  async () => {
    const events: DiagnosticEventInput[] = [];
    let signalAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      signalAborted = resolve;
    });
    const logger = new AppLoggerService(
      'test',
      {
        record(event) {
          events.push(event);
          if (event.event === 'operation.failed') signalAborted?.();
        },
      },
      { write() {} },
    );
    let signalEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let releaseHandler: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    let signalFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      signalFinished = resolve;
    });
    const app = express();
    app.use(recordRequest(logger));
    app.post('/slow', async (_request, response) => {
      signalEntered?.();
      await released;
      if (!response.destroyed) response.status(201).end();
      signalFinished?.();
    });
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const requestId = randomUUID();
    const client = httpRequest({
      host: '127.0.0.1',
      port: address.port,
      path: '/slow',
      method: 'POST',
      headers: { 'x-request-id': requestId },
    });
    client.on('error', () => {
      /* The client deliberately closes its own connection. */
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Aborted request accounting timed out')),
        3000,
      );
    });
    try {
      client.end();
      await Promise.race([entered, deadline]);
      client.destroy();
      await Promise.race([aborted, deadline]);
      releaseHandler?.();
      await Promise.race([finished, deadline]);
      const completions = events.filter(
        (event) => event.event === 'http.completed',
      );
      const operations = events.filter(
        (event) => event.event === 'operation.failed',
      );
      assert.equal(completions.length, 1);
      assert.equal(operations.length, 1);
      for (const event of [...completions, ...operations]) {
        assert.equal(event.requestId, requestId);
        assert.equal(event.method, 'POST');
        assert.equal(event.statusCode, 499);
        assert.equal(event.errorCode, 'REQUEST_ABORTED');
        assert.equal(event.severity, 'warn');
        assert.match(event.operationId ?? '', /^[0-9a-f-]{36}$/);
      }
      assert.equal(completions[0]?.operationId, operations[0]?.operationId);
      assert.equal(
        events.some((event) => event.event === 'operation.completed'),
        false,
      );
    } finally {
      clearTimeout(timeout);
      releaseHandler?.();
      client.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

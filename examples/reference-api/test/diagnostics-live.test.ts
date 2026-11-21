import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { DiagnosticEventInput } from '../dist/core/diagnostics/diagnostic-events.js';
import { AppLoggerService } from '../dist/core/logging/app-logger.service.js';
import { DiagnosticReaderService } from '../dist/modules/diagnostics/diagnostic-reader.service.js';
import { DiagnosticsService } from '../dist/modules/diagnostics/diagnostics.service.js';

type ToolProcess = Readonly<{
  child: ChildProcess;
  output(): string;
  failure(): Error | undefined;
  closed: Promise<void>;
}>;

function startTool(binary: string, args: string[]): ToolProcess {
  const child = spawn(binary, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      NO_COLOR: '1',
      TZ: 'UTC',
    },
  });
  let output = '';
  let failure: Error | undefined;
  const capture = (chunk: Buffer): void => {
    output = (output + chunk.toString('utf8')).slice(-262144);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.once('error', (error) => {
    failure = error;
  });
  child.once('exit', (code, signal) => {
    failure = new Error(
      `Diagnostic process exited (${code ?? signal ?? 'unknown'})`,
    );
  });
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  return { child, output: () => output, failure: () => failure, closed };
}

async function stopTool(tool: ToolProcess | undefined): Promise<void> {
  if (!tool) return;
  if (tool.child.exitCode === null && tool.child.signalCode === null) {
    tool.child.kill('SIGTERM');
    const stopped = await closedWithin(tool, 1500);
    if (!stopped) tool.child.kill('SIGKILL');
  }
  if (!(await closedWithin(tool, 1500)))
    throw new Error('Diagnostic process cleanup timed out');
}

async function closedWithin(
  tool: ToolProcess,
  milliseconds: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.closed.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function listening(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (ready: boolean): void => {
      socket.destroy();
      resolve(ready);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(200, () => finish(false));
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  tools: readonly ToolProcess[],
  label: string,
): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const tool of tools) {
      if (tool.failure())
        throw new Error(
          `${label}: ${tool.failure()?.message}\n${tool.output()}`,
        );
    }
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(
    `${label} timed out\n${tools.map((tool) => tool.output()).join('\n')}`,
  );
}

function receivedEvent(
  output: string,
  operationId: string,
): Record<string, unknown> | undefined {
  for (const line of output.split('\n')) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    try {
      const value: unknown = JSON.parse(line.slice(start));
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'operationId' in value &&
        value.operationId === operationId
      )
        return value as Record<string, unknown>;
    } catch {
      // Tool startup messages are not the newline-delimited application feed.
    }
  }
  return undefined;
}

const vectorBinary = process.env.VECTOR_BINARY;
const logdyBinary = process.env.LOGDY_BINARY;

test(
  'native Vector forwards safe retained events to Logdy and viewer loss leaves evidence available',
  {
    timeout: 30000,
    skip:
      !vectorBinary || !logdyBinary
        ? 'Set absolute VECTOR_BINARY and LOGDY_BINARY paths to reviewed native releases for loopback feed acceptance'
        : false,
  },
  async () => {
    assert.ok(vectorBinary && isAbsolute(vectorBinary));
    assert.ok(logdyBinary && isAbsolute(logdyBinary));
    await Promise.all([
      access(vectorBinary, constants.X_OK),
      access(logdyBinary, constants.X_OK),
    ]);
    const directory = await mkdtemp(
      join(tmpdir(), 'reference-diagnostics-live-'),
    );
    const evidence = {
      directory: join(directory, 'evidence'),
      maxBytes: 8192,
      maxFiles: 2,
    };
    const writer = await DiagnosticsService.open(evidence, 'test');
    const reader = new DiagnosticReaderService(evidence, 'test');
    const stdout: string[] = [];
    const logger = new AppLoggerService('test', writer, {
      write: (line) => stdout.push(line),
    });
    let logdy: ToolProcess | undefined;
    let vector: ToolProcess | undefined;
    try {
      assert.equal(writer.status().available, true);
      const feedPort = await unusedPort();
      let uiPort = await unusedPort();
      while (uiPort === feedPort) uiPort = await unusedPort();
      const checkpointDirectory = join(directory, 'checkpoints');
      await mkdir(checkpointDirectory);
      const original = await readFile(
        new URL('../ops/diagnostics/vector.yaml', import.meta.url),
        'utf8',
      );
      const configuration = original
        .replace(
          /^data_dir:.*$/m,
          `data_dir: ${JSON.stringify(checkpointDirectory)}`,
        )
        .replace(
          /^ {4}include:.*$/m,
          `    include: [${JSON.stringify(join(evidence.directory, 'events-*.jsonl'))}]`,
        )
        .replace(/^ {4}address:.*$/m, `    address: 127.0.0.1:${feedPort}`)
        .replace(/^tests:[\s\S]*$/m, '');
      assert.notEqual(configuration, original);
      assert.equal(
        configuration.includes('include: [/evidence/events-*.jsonl]'),
        false,
      );
      assert.equal(configuration.includes('host.docker.internal:'), false);
      const configPath = join(directory, 'vector.yaml');
      await writeFile(configPath, configuration, { mode: 0o600 });
      logdy = startTool(logdyBinary, [
        'socket',
        String(feedPort),
        '--ip=127.0.0.1',
        '--ui-ip=127.0.0.1',
        `--port=${uiPort}`,
        '--no-updates',
        '--no-analytics',
        '--max-message-count=1000',
        '--fallthrough',
      ]);
      await waitFor(
        () => listening(feedPort),
        [logdy],
        'Logdy private feed listener',
      );
      vector = startTool(vectorBinary, [
        '--config',
        configPath,
        '--threads',
        '1',
        '--color',
        'never',
        '--graceful-shutdown-limit-secs',
        '2',
      ]);
      const operationId = randomUUID();
      const requestId = randomUUID();
      const sentinel = 'private-native-feed-cookie-token-signed-url';
      logger.record({
        event: 'http.completed',
        severity: 'info',
        operationId,
        requestId,
        method: 'POST',
        statusCode: 201,
        route: '/notes',
        durationMs: 12.5,
        count: 2,
        headers: { authorization: sentinel },
        message: sentinel,
        body: { password: sentinel },
        error: new Error(sentinel),
      } as DiagnosticEventInput);
      assert.equal(await writer.flush(), true);
      const activeLogdy = logdy;
      await waitFor(
        () => Boolean(receivedEvent(activeLogdy.output(), operationId)),
        [vector, logdy],
        'Vector to Logdy application event',
      );
      const received = receivedEvent(logdy.output(), operationId);
      assert.ok(received);
      assert.equal(received.event, 'http.completed');
      assert.equal(received.environment, 'test');
      assert.equal(received.project, 'reference-api');
      assert.equal(received.service, 'reference-api');
      assert.equal(received.source, 'application-jsonl');
      assert.equal(received.parse_status, 'normalized');
      assert.equal(received.requestId, requestId);
      assert.equal(received.operationId, operationId);
      assert.equal(received.method, 'POST');
      assert.equal(received.statusCode, 201);
      assert.equal(received.route, '/notes');
      assert.equal(received.durationMs, 12.5);
      assert.equal(received.count, 2);
      assert.equal(typeof received.writerId, 'string');
      assert.equal(received.sequence, 1);
      assert.equal(logdy.output().includes(sentinel), false);
      assert.equal(vector.output().includes(sentinel), false);
      assert.equal(stdout.join('').includes(sentinel), false);
      await stopTool(logdy);
      const offlineOperationId = randomUUID();
      const started = performance.now();
      logger.record({
        event: 'operation.completed',
        severity: 'info',
        operationId: offlineOperationId,
      });
      assert.equal(await writer.flush(1000), true);
      assert.ok(performance.now() - started < 1500);
      assert.equal(writer.status().available, true);
      const retained = await reader.search({ operationId: offlineOperationId });
      assert.equal(retained.events.length, 1);
      assert.equal(retained.events[0]?.event, 'operation.completed');
      assert.equal(vector.failure(), undefined);
    } finally {
      const stopped = await Promise.allSettled([
        stopTool(vector),
        stopTool(logdy),
      ]);
      try {
        await writer.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      assert.ok(
        stopped.every((result) => result.status === 'fulfilled'),
        'Diagnostic process cleanup failed',
      );
    }
  },
);

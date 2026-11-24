import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  stat,
  appendFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import ts from 'typescript';
import { linkGeneratedDependencies } from './generated-dependencies.ts';

// Only this worker-owned ignored fixture is emitted. Reuse installed SDKs without installs.
await mkdir(resolve('var'), { recursive: true });
const fixture = await mkdtemp(resolve('var/cli-diagnostic-sources-'));
const source = resolve('templates/runtime/common');
const servers = new Set<Server>();
after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await rm(fixture, { recursive: true, force: true });
});
await linkGeneratedDependencies(fixture);
await cp(join(source, 'src/core/logging'), join(fixture, 'src/core/logging'), {
  recursive: true,
});
await cp(
  join(source, 'src/core/diagnostics'),
  join(fixture, 'src/core/diagnostics'),
  { recursive: true },
);
await cp(
  join(source, 'src/modules/diagnostics'),
  join(fixture, 'src/modules/diagnostics'),
  { recursive: true },
);
await mkdir(join(fixture, 'src/core/errors'), { recursive: true });
await cp(
  join(source, 'src/core/errors/application-error.ts'),
  join(fixture, 'src/core/errors/application-error.ts'),
);
await mkdir(join(fixture, 'src/core/config'), { recursive: true });
await writeFile(
  join(fixture, 'src/core/config/app-config.ts'),
  "export type AppConfig = {environment:'development'|'test'|'production';diagnostics:{directory:string;maxBytes:number;maxFiles:number;maxAgeMs?:number}};\n",
);
await writeFile(
  join(fixture, 'package.json'),
  '{"type":"module","private":true}\n',
);
const config = {
  compilerOptions: {
    target: 'ES2023',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    noUncheckedIndexedAccess: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    skipLibCheck: true,
    esModuleInterop: true,
    outDir: 'out',
    rootDir: 'src',
    types: ['node'],
  },
  include: ['src/**/*.ts'],
};
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, fixture);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(
  diagnostics.length,
  0,
  ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => fixture,
    getNewLine: () => '\n',
  }),
);
assert.equal(program.emit().emitSkipped, false);
const load = (path: string) =>
  import(pathToFileURL(join(fixture, 'out', path + '.js')).href);
const { DiagnosticsService } = await load(
  'modules/diagnostics/diagnostics.service',
);
const { SourceEvidenceService } = await load(
  'modules/diagnostics/source-evidence.service',
);
const { DiagnosticReaderService } = await load(
  'modules/diagnostics/diagnostic-reader.service',
);
const { AppLoggerService } = await load('core/logging/app-logger.service');
const { JobDiagnosticsService } = await load(
  'core/diagnostics/job-diagnostics.service',
);
const { DatabaseDiagnosticsService } = await load(
  'core/diagnostics/database-diagnostics.service',
);
const { InfrastructureDiagnosticsService } = await load(
  'core/diagnostics/infrastructure-diagnostics.service',
);
const { TestEvidenceService } = await load(
  'modules/diagnostics/test-evidence.service',
);
const { RemoteDiagnosticReader } = await load(
  'modules/diagnostics/remote-diagnostic-reader',
);
const { RemoteDiagnosticServer } = await load(
  'modules/diagnostics/remote-diagnostic-server',
);
const { executeDiagnosticQuery } = await load(
  'modules/diagnostics/diagnostic-query',
);
const { DiagnosticsMcpService } = await load(
  'modules/diagnostics/diagnostics-mcp.service',
);
async function listen(server: Server): Promise<number> {
  servers.add(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  return address.port;
}
async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  servers.delete(server);
}
let generation = 0;
async function directory(label: string) {
  const value = join(fixture, 'evidence', `${++generation}-${label}`);
  await rm(value, { recursive: true, force: true });
  await mkdir(value, { recursive: true, mode: 0o700 });
  return value;
}
const sources = [
  'application',
  'workers',
  'database',
  'infrastructure',
  'tests',
];
const sentinel = 'PRIVATE_SENTINEL_TOKEN_COOKIE_SQL_PROVIDER';
const scope = () => ({ runId: randomUUID(), operationId: randomUUID() });
function profile(
  port: number,
  grant: unknown,
  readToken = randomBytes(32).toString('base64url'),
) {
  return {
    profile: 'restricted-remote-read',
    endpoint: `http://127.0.0.1:${port}/v1/diagnostics/query`,
    readToken,
    grant,
    timeoutMs: 200,
  };
}
async function raw(
  port: number,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: false,
        headers: { authorization: `Bearer ${token}` },
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on('data', (part) => parts.push(part));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            body: Buffer.concat(parts).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('isolated runtime compiles with strict TypeScript and existing cached SDKs', () => {
  assert.equal(diagnostics.length, 0);
});

test('actual job callbacks and process samples retain correlated finite source facts with redaction', async () => {
  const config = {
    directory: await directory('sources'),
    maxBytes: 8192,
    maxFiles: 3,
  };
  const sink = await SourceEvidenceService.open(config, 'test', sources);
  let stdout = '';
  const logger = new AppLoggerService('test', sink, {
    write: (value: string) => {
      stdout += value;
    },
  });
  const context = scope();
  const worker = new JobDiagnosticsService(logger);
  const database = new DatabaseDiagnosticsService(logger, 'postgres');
  const infrastructure = new InfrastructureDiagnosticsService(logger);
  let calls = 0;
  try {
    await logger.runWithContext(context, async () => {
      logger.record({
        event: 'http.completed',
        severity: 'info',
        route: '/notes',
        headers: { authorization: sentinel },
        message: `touch ${sentinel}`,
      });
      await worker.run('diagnostic-check', async () => {
        calls++;
        return 'value';
      });
      const failure = new Error(sentinel);
      await assert.rejects(
        worker.run('mail-dispatch', async () => {
          throw failure;
        }),
        (error) => error === failure,
      );
      await database.observe('transaction', async () => {
        calls++;
        return 7;
      }); // Controlled native-operation callback, not a real DB.
      await assert.rejects(
        database.observe('read', async () => {
          throw failure;
        }),
        (error) => error === failure,
      );
      infrastructure.sample();
      for (const event of [
        { event: 'job.completed', source: 'workers', job: 'maintenance' },
        {
          event: 'database.completed',
          source: 'database',
          database: 'postgres',
          databaseOperation: 'write',
        },
        {
          event: 'infrastructure.sampled',
          source: 'infrastructure',
          infrastructure: {
            component: 'node-process',
            rssBytes: 1,
            heapUsedBytes: 1,
            uptimeSeconds: 1,
          },
        },
      ])
        logger.record({
          ...event,
          severity: 'info',
          parameters: [sentinel],
          providerMessage: sentinel,
          message: sentinel,
        });
    });
    assert.equal(calls, 2);
    assert.equal(await sink.flush(), true);
    const reader = new DiagnosticReaderService(config, 'test', { sources });
    const page = await reader.search({ runId: context.runId, limit: 100 });
    assert.deepEqual(
      new Set(page.events.map((event: { source: string }) => event.source)),
      new Set(['application', 'workers', 'database', 'infrastructure']),
    );
    assert.equal(
      page.events.every(
        (event: { operationId: string }) =>
          event.operationId === context.operationId,
      ),
      true,
    );
    assert.equal(JSON.stringify(page).includes(sentinel), false);
    assert.equal(stdout.includes(sentinel), false);
    for (const selected of sources) {
      const path =
        selected === 'application'
          ? config.directory
          : join(config.directory, selected);
      assert.equal((await stat(path)).mode & 0o777, 0o700);
      for (const name of await readdir(path)) {
        const info = await stat(join(path, name));
        assert.equal(info.mode & 0o777, info.isDirectory() ? 0o700 : 0o600);
        if (info.isFile())
          assert.equal(
            (await readFile(join(path, name), 'utf8')).includes(sentinel),
            false,
          );
      }
    }
    assert(
      page.coverage.unavailableSources.includes(
        'vector-live-feed-not-observed',
      ),
    );
    assert.equal(page.coverage.sourceCoverage.length, 5);
  } finally {
    infrastructure.stop();
    await sink.close();
    await logger.flush();
  }
});

test('source parsing rejects wrong labels, private known fields and malformed events without executing log text', async () => {
  const config = {
    directory: await directory('parse'),
    maxBytes: 8192,
    maxFiles: 3,
  };
  const sink = await SourceEvidenceService.open(config, 'test', sources);
  const context = scope();
  try {
    for (const source of sources) {
      sink.record({
        event: 'source.status',
        source,
        severity: 'info',
        ...context,
        message: `$(touch ${join(config.directory, sentinel)})`,
        token: sentinel,
      });
      sink.record({
        event: 'job.completed',
        source,
        job: sentinel,
        severity: 'info',
      });
    }
    await sink.flush();
    const reader = new DiagnosticReaderService(config, 'test', { sources });
    const page = await reader.search({ limit: 100 });
    assert.equal(JSON.stringify(page).includes(sentinel), false);
    assert(
      page.coverage.gaps.some((gap: string) =>
        gap.endsWith(':writer-malformed'),
      ),
    );
    assert.equal(
      page.events.filter(
        (event: { event: string }) => event.event === 'job.completed',
      ).length,
      0,
    );
    await assert.rejects(stat(join(config.directory, sentinel)));
    for (const input of [
      { path: '../.env' },
      { shell: 'touch x' },
      { sql: 'SELECT 1' },
      { containerId: 'arbitrary' },
      { project: 'foreign' },
      { runId: '../other' },
      { source: 'docker' },
      { limit: 101 },
    ])
      await assert.rejects(reader.search(input));
  } finally {
    await sink.close();
  }
});

test('retained assertion metadata separates failures from incomplete logs and touches no unrelated process', async () => {
  const unrelated = createServer((_req, res) => res.end('unrelated'));
  const port = await listen(unrelated);
  const config = {
    directory: await directory('tests'),
    maxBytes: 8192,
    maxFiles: 3,
  };
  const sink = await SourceEvidenceService.open(config, 'test', ['tests']);
  const context = scope();
  let stopped = 0;
  try {
    const capture = new TestEvidenceService(sink);
    const result = await capture.capture(
      context,
      async () => {
        throw new Error(sentinel);
      },
      {
        flush: () => new Promise(() => {}),
        stopOwned: async () => {
          stopped++;
          return true;
        },
        deadlineMs: 20,
      },
    );
    assert.equal(result.outcome, 'failed');
    assert.equal(result.logsComplete, false);
    assert.equal(result.resultRetained, false);
    assert.equal(stopped, 1);
    await sink.flush();
    const reader = new DiagnosticReaderService(config, 'test', {
      sources: ['tests'],
    });
    const page = await executeDiagnosticQuery(
      reader,
      'tests.getResult',
      context,
    );
    assert.equal(page.events[0].testResult.outcome, 'failed');
    assert.equal(page.events[0].testResult.logsComplete, false);
    assert.equal(JSON.stringify(page).includes(sentinel), false);
    const report = await capture.capture(
      scope(),
      async () => ({
        assertions: [
          {
            check: 'redaction',
            ordinal: 0,
            outcome: 'passed',
            code: 'MATCH',
            message: sentinel,
          },
        ],
        artifacts: [
          {
            kind: 'assertion-report',
            bytes: 1,
            sha256: 'a'.repeat(64),
            path: sentinel,
            url: sentinel,
            content: sentinel,
          },
        ],
      }),
      { flush: () => sink.flush(), stopOwned: async () => true },
    );
    assert.equal(report.outcome, 'passed');
    assert.equal(JSON.stringify(report).includes(sentinel), false);
    const invalid = await capture.capture(
      scope(),
      async () => ({ assertions: [], artifacts: [] }),
      { flush: () => sink.flush(), stopOwned: async () => true },
    );
    assert.equal(invalid.outcome, 'aborted');
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
    await assert.rejects(executeDiagnosticQuery(reader, 'tests.run', {}));
    await assert.rejects(
      reader.getTestResult({ ...context, path: '../../secret' }),
    );
  } finally {
    await sink.close();
    await stop(unrelated);
  }
});

test('cursor rotation, source disconnect, restart, expiry, malformed and oversized records remain bounded', async () => {
  const config = {
    directory: await directory('cursor'),
    maxBytes: 1024,
    maxFiles: 2,
  };
  const writer = await DiagnosticsService.open(config, 'test');
  const context = scope();
  try {
    for (let index = 0; index < 3; index++) {
      writer.record({
        event: 'operation.completed',
        severity: 'info',
        ...context,
      });
      await writer.flush();
    }
    const reader = new DiagnosticReaderService(config, 'test', {
      sources: ['application', 'database'],
    });
    const first = await reader.search({ runId: context.runId, limit: 1 });
    assert(first.cursor);
    assert(first.coverage.unavailableSources.includes('database'));
    await assert.rejects(
      reader.search({ runId: randomUUID(), limit: 1, cursor: first.cursor }),
    );
    await assert.rejects(
      new DiagnosticReaderService(config, 'test').search({
        runId: context.runId,
        limit: 1,
        cursor: first.cursor,
      }),
    );
    await assert.rejects(
      new DiagnosticReaderService(config, 'production').search({
        runId: context.runId,
        limit: 1,
        cursor: first.cursor,
      }),
    );
    for (let index = 0; index < 10; index++) {
      writer.record({
        event: 'operation.completed',
        severity: 'info',
        ...context,
      });
      await writer.flush();
    }
    await assert.rejects(
      reader.search({ runId: context.runId, limit: 1, cursor: first.cursor }),
    );
  } finally {
    await writer.close();
  }
  const restart = await DiagnosticsService.open(config, 'test');
  assert.equal(restart.status().available, true);
  await restart.close();
  const names = (await readdir(config.directory)).filter((name) =>
    name.endsWith('.jsonl'),
  );
  const chosen = join(config.directory, names.at(-1)!);
  await writeFile(
    chosen,
    '{malformed\n' +
      JSON.stringify({
        event: 'operation.completed',
        severity: 'info',
        version: 1,
        project: 'generated-api',
        service: 'generated-api',
        environment: 'test',
        timestamp: '2020-01-01T00:00:00.000Z',
        writerId: randomUUID(),
        sequence: 1,
      }) +
      '\n',
  );
  const ageReader = new DiagnosticReaderService(
    { ...config, maxAgeMs: 1000 },
    'test',
  );
  const page = await ageReader.search({});
  assert(page.coverage.gaps.includes('malformed-record'));
  assert(page.coverage.gaps.includes('expired-evidence'));
  const largeConfig = { ...config, maxBytes: 8192 };
  await appendFile(chosen, 'x'.repeat(5000) + '\n');
  assert(
    (
      await new DiagnosticReaderService(largeConfig, 'test').search({})
    ).coverage.gaps.includes('oversized-or-incomplete-record'),
  );
  await symlink(
    '/etc/passwd',
    join(config.directory, `events-${Date.now()}-${randomUUID()}.jsonl`),
  );
  const unsafe = await new DiagnosticReaderService(
    { ...largeConfig, maxFiles: 10 },
    'test',
  ).search({});
  assert(unsafe.coverage.unavailableSources.includes('application'));
});

test('writer overload and lost viewer never retry business work and remain bounded', async () => {
  const config = {
    directory: await directory('overload'),
    maxBytes: 512,
    maxFiles: 2,
  };
  const writer = await DiagnosticsService.open(config, 'test');
  const logger = new AppLoggerService('test', writer, {
    write: () => {
      throw new Error(sentinel);
    },
  });
  let calls = 0;
  try {
    const job = new JobDiagnosticsService(logger);
    await job.run('diagnostic-check', async () => {
      calls++;
      for (let index = 0; index < 1000; index++)
        logger.record({ event: 'operation.completed', severity: 'info' });
    });
    assert.equal(calls, 1);
    assert(writer.status().dropped > 0);
    assert(writer.status().queued <= 128);
    assert.equal(await writer.flush(), false);
    const page = await new DiagnosticReaderService(config, 'test').search({});
    assert(page.events.length > 0);
    assert(
      page.coverage.unavailableSources.includes(
        'vector-live-feed-not-observed',
      ),
    );
    assert(logger.status().stdoutFailures > 0);
  } finally {
    await writer.close();
    await logger.flush();
  }
});

test('stale lock never steals another writer and maximal multi-source cursor stays usable and scope-bound', async () => {
  const config = {
    directory: await directory('locks'),
    maxBytes: 512,
    maxFiles: 10,
  };
  const writer = await DiagnosticsService.open(config, 'test');
  const conflicting = await DiagnosticsService.open(config, 'test');
  assert.equal(conflicting.status().available, false);
  await conflicting.close();
  assert((await stat(join(config.directory, 'writer.lock'))).isFile());
  await writer.close();
  await writeFile(join(config.directory, 'writer.lock'), '', { mode: 0o600 }); // Simulated stale crash lock; no process is assumed dead by implementation.
  const stale = await DiagnosticsService.open(config, 'test');
  assert.equal(stale.status().available, false);
  await stale.close();
  await rm(join(config.directory, 'writer.lock'));
  const sink = await SourceEvidenceService.open(config, 'test', sources);
  const context = scope();
  try {
    for (let index = 0; index < 15; index++) {
      for (const source of sources)
        sink.record({
          event: 'source.status',
          severity: 'info',
          source,
          ...context,
          count: index,
        });
      await sink.flush();
    }
    const reader = new DiagnosticReaderService(config, 'test', { sources });
    const first = await reader.search({ ...context, limit: 1 });
    assert(first.cursor);
    assert(first.cursor.length < 16384);
    const next = await reader.search({
      ...context,
      limit: 1,
      cursor: first.cursor,
    });
    assert.equal(next.events.length, 1);
    const original = Date.now;
    try {
      const time = original();
      Date.now = () => time + 300001;
      await assert.rejects(
        reader.search({ ...context, limit: 1, cursor: first.cursor }),
      );
    } finally {
      Date.now = original;
    }
    const grant = {
      project: 'generated-api',
      environment: 'test',
      runs: [{ runId: context.runId, operationIds: [context.operationId] }],
    };
    await assert.rejects(
      new DiagnosticReaderService(config, 'test', { sources, grant }).search({
        ...context,
        limit: 1,
        cursor: first.cursor,
      }),
    );
  } finally {
    await sink.close();
  }
});

test('private remote profiles reject symlinks, public permissions and unsupported authority without environment fallback', async () => {
  const { readPrivateDiagnosticProfile } = await import(
    pathToFileURL(join(source, 'scripts/diagnostics-private-profile.mjs')).href
  );
  const root = await directory('private-profile');
  const path = join(root, 'profile.json');
  const context = scope();
  const grant = {
    project: 'generated-api',
    environment: 'test',
    runs: [{ runId: context.runId, operationIds: [context.operationId] }],
  };
  const selected = profile(58234, grant);
  await writeFile(path, JSON.stringify(selected), { mode: 0o600 });
  assert.equal(
    (await readPrivateDiagnosticProfile(path)).readToken,
    selected.readToken,
  );
  const linked = join(root, 'link.json');
  await symlink(path, linked);
  await assert.rejects(readPrivateDiagnosticProfile(linked));
  const publicPath = join(root, 'public.json');
  await writeFile(publicPath, JSON.stringify(selected), { mode: 0o644 });
  await assert.rejects(readPrivateDiagnosticProfile(publicPath));
  assert.throws(
    () =>
      new RemoteDiagnosticReader({
        ...selected,
        profile: 'isolated-production',
      }),
  );
  assert.throws(
    () => new RemoteDiagnosticReader({ ...selected, operatorToken: sentinel }),
  );
  assert.throws(
    () => new RemoteDiagnosticReader({ ...selected, readToken: undefined }),
  );
  await writeFile(path, 'x'.repeat(16385), { mode: 0o600 });
  await assert.rejects(readPrivateDiagnosticProfile(path));
});

test('directory pollution and symlinked source roots fail bounded without collecting foreign evidence', async () => {
  const root = await directory('directory-bounds');
  const config = { directory: root, maxBytes: 8192, maxFiles: 3 };
  await Promise.all(
    Array.from({ length: 129 }, (_, index) =>
      writeFile(join(root, `unrecognized-${index}`), '', { mode: 0o600 }),
    ),
  );
  const reader = new DiagnosticReaderService(config, 'test');
  const result = await reader.search({});
  assert(result.coverage.unavailableSources.includes('application'));
  const blocked = await DiagnosticsService.open(config, 'test');
  assert.equal(blocked.status().available, false);
  await blocked.close();
  const foreign = await directory('foreign-source-root');
  const linked = join(root, 'source-link');
  await symlink(foreign, linked);
  const unavailable = await SourceEvidenceService.open(
    { ...config, directory: linked },
    'test',
    ['workers'],
  );
  assert.equal(unavailable.status().workers.available, false);
  let stdout = '';
  const logger = new AppLoggerService('test', unavailable, {
    write: (value: string) => {
      stdout += value;
    },
  });
  try {
    assert.equal(
      await new JobDiagnosticsService(logger).run(
        'diagnostic-check',
        async () => 7,
      ),
      7,
    );
    assert(stdout.includes('job.completed'));
    assert.equal(await unavailable.flush(), false);
  } finally {
    await unavailable.close();
    await logger.flush();
  }
  await assert.rejects(
    SourceEvidenceService.open(config, 'test', ['../../foreign']),
  );
  await assert.rejects(stat(join(foreign, 'workers')));
});

test('maximum assertion metadata remains retained and output pages stay below remote response budget', async () => {
  const config = {
    directory: await directory('report-bounds'),
    maxBytes: 524288,
    maxFiles: 3,
  };
  const sink = await SourceEvidenceService.open(config, 'test', ['tests']);
  const context = scope();
  const report = {
    revision: 'a'.repeat(64),
    dirty: true,
    capabilities: [
      'foundation.nest',
      'database.postgres',
      'auth.local',
      'mail.smtp',
      'storage.aws-s3',
      'media.private',
      'push.fcm',
      'push.apns',
      'realtime.native-ws',
      'diagnostics.local',
      'deployment.dokploy',
    ],
    versions: {
      node: '26.13.1',
      database: '16.16.0',
      vector: '0.62.0',
      logdy: '0.17.1',
      private: sentinel,
    },
    assertions: Array.from({ length: 8 }, (_, ordinal) => ({
      check: 'authorization',
      ordinal: 10000 - ordinal,
      outcome: ordinal === 0 ? 'passed' : 'skipped',
      code: ordinal === 0 ? 'MATCH' : 'NOT_OBSERVED',
    })),
    artifacts: Array.from({ length: 4 }, () => ({
      kind: 'assertion-report',
      bytes: 10485760,
      sha256: 'a'.repeat(64),
      path: sentinel,
    })),
  };
  try {
    const result = await new TestEvidenceService(sink).capture(
      context,
      async () => report,
      { flush: () => sink.flush(), stopOwned: async () => true },
    );
    assert.equal(result.outcome, 'passed');
    assert.equal(result.resultRetained, true);
    for (let index = 0; index < 99; index++) {
      sink.record({
        event: 'test.result',
        severity: 'info',
        source: 'tests',
        ...context,
        testResult: {
          ...report,
          outcome: 'passed',
          logsComplete: true,
          cleanupComplete: true,
        },
      });
      if (index % 10 === 0) await sink.flush();
    }
    assert.equal(await sink.flush(), true);
    const reader = new DiagnosticReaderService(config, 'test', {
      sources: ['tests'],
    });
    const page = await reader.getTestResult(context);
    assert.equal(page.truncated, true);
    assert(Buffer.byteLength(JSON.stringify(page)) < 262144);
    assert(page.events.length > 1 && page.events.length < 100);
    assert.equal(page.events[0].testResult.revision, report.revision);
    assert.equal(page.events[0].testResult.versions.node, '26.13.1');
    assert.equal(JSON.stringify(page).includes(sentinel), false);
    const next = await reader.getTestResult({
      ...context,
      cursor: page.cursor,
    });
    assert.equal(next.events.length + page.events.length, 100);
  } finally {
    await sink.close();
  }
});

test('restricted remote loopback enforces auth, project/environment/run/operation, endpoint and disconnection bounds', async () => {
  const config = {
    directory: await directory('remote'),
    maxBytes: 8192,
    maxFiles: 3,
  };
  const writer = await DiagnosticsService.open(config, 'test');
  const context = scope();
  const grant = {
    project: 'generated-api',
    environment: 'test',
    runs: [{ runId: context.runId, operationIds: [context.operationId] }],
  };
  const token = randomBytes(32).toString('base64url');
  const reader = new DiagnosticReaderService(config, 'test', { grant });
  const server = new RemoteDiagnosticServer(
    reader,
    token,
    grant,
  ).createHttpServer();
  const port = await listen(server);
  const selected = profile(port, grant, token);
  const remote = new RemoteDiagnosticReader(selected);
  try {
    writer.record({
      event: 'operation.completed',
      severity: 'info',
      ...context,
    });
    writer.record({
      event: 'operation.completed',
      severity: 'info',
      runId: context.runId,
      operationId: randomUUID(),
    });
    await writer.flush();
    const page = await remote.search({ ...context, limit: 1 });
    assert.equal(page.events.length, 1);
    assert.equal(page.events[0].operationId, context.operationId);
    const status = await remote.status();
    assert.equal(status.retainedBytes, 0);
    await assert.rejects(remote.search({ runId: randomUUID() }));
    await assert.rejects(
      remote.search({ runId: context.runId, operationId: randomUUID() }),
    );
    await assert.rejects(
      new RemoteDiagnosticReader(profile(port, grant)).search(context),
    );
    for (const endpoint of [
      `http://example.com/v1/diagnostics/query`,
      `http://192.0.2.1/v1/diagnostics/query`,
      `http://127.0.0.1:${port}/admin`,
      `http://127.0.0.1:${port}/a/../v1/diagnostics/query`,
      `http://127.0.0.1:${port}/v1/diagnostics/query?path=/etc/passwd`,
      `http://127.0.0.1:${port}/v1/diagnostics/query?`,
      `http://127.0.0.1:${port}/v1/diagnostics/query#`,
      `http://x:y@127.0.0.1:${port}/v1/diagnostics/query`,
    ])
      assert.throws(
        () => new RemoteDiagnosticReader({ ...selected, endpoint }),
      );
    const query = {
      project: 'generated-api',
      environment: 'test',
      tool: 'logs.search',
      input: context,
    };
    assert.equal((await raw(port, '/admin', query, token)).status, 404);
    assert.equal(
      (
        await raw(
          port,
          '/v1/diagnostics/query',
          { ...query, project: 'other' },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await raw(
          port,
          '/v1/diagnostics/query',
          { ...query, environment: 'production' },
          token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await raw(
          port,
          '/v1/diagnostics/query',
          { ...query, input: { runId: randomUUID() } },
          token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await raw(
          port,
          '/v1/diagnostics/query',
          { ...query, tool: 'shell.run' },
          token,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await raw(
          port,
          '/v1/diagnostics/query',
          { ...query, input: { ...context, path: '/etc/passwd' } },
          token,
        )
      ).status,
      400,
    );
    await stop(server);
    await assert.rejects(
      remote.search(context),
      (error) => error instanceof Error && !String(error).includes(token),
    );
  } finally {
    await writer.close();
    if (servers.has(server)) await stop(server);
  }
});

test('remote refuses redirects, oversized/malicious protocol output and bounded hangs without credential egress', async () => {
  let egress = 0;
  const foreign = createServer((_req, res) => {
    egress++;
    res.end('{}');
  });
  const foreignPort = await listen(foreign);
  const context = scope();
  const grant = {
    project: 'generated-api',
    environment: 'test',
    runs: [{ runId: context.runId, operationIds: [context.operationId] }],
  };
  let mode = 'redirect';
  const peer = createServer((_req, res) => {
    if (mode === 'redirect') {
      res.writeHead(302, {
        location: `http://127.0.0.1:${foreignPort}/secrets`,
      });
      res.end();
    } else if (mode === 'oversize') res.end('x'.repeat(262145));
    else if (mode === 'malformed') res.end(`{"value":"${sentinel}"}`);
    // The hang fixture intentionally leaves the socket open; finally closes task-owned peers.
  });
  const port = await listen(peer);
  const reader = new RemoteDiagnosticReader(profile(port, grant));
  try {
    for (const value of ['redirect', 'oversize', 'malformed', 'hang']) {
      mode = value;
      await assert.rejects(
        reader.search(context),
        (error) => error instanceof Error && !String(error).includes(sentinel),
      );
    }
    assert.equal(egress, 0);
  } finally {
    await stop(peer);
    await stop(foreign);
  }
});

test('MCP uses real in-memory protocol transport for read-only test metadata and rejects mutation tools', async () => {
  const config = {
    directory: await directory('mcp'),
    maxBytes: 8192,
    maxFiles: 3,
  };
  const writer = await SourceEvidenceService.open(config, 'test', ['tests']);
  const context = scope();
  const reader = new DiagnosticReaderService(config, 'test', {
    sources: ['tests'],
  });
  const server = new DiagnosticsMcpService(reader);
  const client = new Client({ name: 'diagnostic-contract', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await new TestEvidenceService(writer).capture(
      context,
      async () => ({
        assertions: [
          {
            check: 'invariant',
            ordinal: 0,
            outcome: 'failed',
            code: 'MISMATCH',
          },
        ],
        artifacts: [],
      }),
      { flush: () => writer.flush(), stopOwned: async () => true },
    );
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 6);
    assert(tools.tools.every((tool) => tool.annotations?.readOnlyHint));
    const result = CallToolResultSchema.parse(
      await client.callTool({ name: 'tests.getResult', arguments: context }),
    );
    assert.equal(result.isError, undefined);
    const content = result.content[0];
    assert.ok(content?.type === 'text');
    assert.equal(
      JSON.parse(content.text).events[0].testResult.outcome,
      'failed',
    );
    for (const name of [
      'shell.run',
      'sql.query',
      'tests.run',
      'docker.inspect',
      'deploy.apply',
    ])
      assert.equal(
        (await client.callTool({ name, arguments: {} })).isError,
        true,
      );
    assert.equal(
      (
        await client.callTool({
          name: 'logs.search',
          arguments: { path: '../../.env' },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close();
    await server.close();
    await writer.close();
  }
});

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  createServer as httpServer,
  request as httpRequest,
  type Server as HttpServer,
} from 'node:http';
import { createServer, connect } from 'node:net';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import type { ProjectConfig, RecipeCatalog } from '../src/contracts.ts';

const sources = [
  'application',
  'workers',
  'database',
  'infrastructure',
  'tests',
] as const;
type Facts = Record<string, unknown>;
type Page = {
  events: Facts[];
  coverage: { sources: string[]; unavailableSources: string[]; gaps: string[] };
  cursor?: string;
  truncated: boolean;
};
export function validateDiagnosticBrowserEvidence(
  input: unknown,
  project: string,
) {
  return z
    .object({
      passed: z.literal(true),
      tool: z.literal('existing Playwright MCP only'),
      project: z.literal(project),
      recordsObserved: z.number().int().min(1).max(128),
      sources: z
        .array(z.enum(sources))
        .length(5)
        .refine((value) => new Set(value).size === 5),
      secretAbsent: z.literal(true),
      foreignProjectAbsent: z.literal(true),
      browserClosed: z.literal(true),
    })
    .parse(input);
}
type Reader = {
  search(input: unknown): Promise<Page>;
  getTestResult(input: unknown): Promise<Page>;
  status(): Promise<unknown>;
};
type Sink = {
  record(input: Facts): void;
  flush(): Promise<boolean>;
  close(): Promise<void>;
  status(): Record<
    string,
    { available: boolean; queued: number; dropped: number }
  >;
};
type Logger = {
  record(input: Facts): void;
  runWithContext<T>(context: Facts, callback: () => T): T;
  flush(): Promise<boolean>;
};
type Capture = {
  capture(
    scope: Facts,
    execute: () => Promise<unknown>,
    hooks: {
      flush: () => Promise<boolean>;
      stopOwned: () => Promise<boolean>;
      deadlineMs?: number;
    },
  ): Promise<{
    outcome: string;
    logsComplete: boolean;
    resultRetained: boolean;
  }>;
};
type Step = { name: string; passed: boolean; elapsedMs: number };
type Tool = {
  child: ChildProcess;
  closed: Promise<void>;
  output: () => string;
  peakRssKiB: number;
  peakThreads: number;
  expectedStop: boolean;
};
export type DiagnosticServicesReport = {
  passed: boolean;
  cases: Step[];
  facts: Facts;
  cleanup: boolean;
  error?: string;
};
const rootDefault = resolve('var/cli-diagnostic-services');
const sentinel = 'SYNTHETIC_DIAGNOSTIC_SERVICE_SECRET';
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
async function fileHash(path: string): Promise<string> {
  const value = createHash('sha256');
  for await (const chunk of createReadStream(path))
    value.update(chunk as Buffer);
  return value.digest('hex');
}

async function until(
  check: () => boolean | Promise<boolean>,
  label: string,
  milliseconds = 15000,
): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + label);
}
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
async function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = (value: boolean) => {
      socket.destroy();
      done(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(200, () => finish(false));
  });
}
function nativeTool(binary: string, args: string[], cwd: string): Tool {
  const vector = binary.endsWith('/vector');
  const child = spawn(
    '/usr/bin/prlimit',
    [
      `--as=${vector ? 1073741824 : 2147483648}`,
      '--cpu=180',
      '--nofile=256',
      '--',
      binary,
      ...args,
    ],
    {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        TZ: 'UTC',
        LANG: 'C.UTF-8',
        NO_COLOR: '1',
        GOMAXPROCS: '1',
        GOMEMLIMIT: '96MiB',
        RAYON_NUM_THREADS: '1',
        TOKIO_WORKER_THREADS: '1',
      },
    },
  );
  let output = '';
  const capture = (chunk: Buffer) => {
    output = (output + chunk.toString('utf8')).slice(-262144);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.once('error', (error) => {
    output += '\nSPAWN_FAILED:' + error.name;
  });
  const tool: Tool = {
    child,
    closed: new Promise((done) => child.once('close', () => done())),
    output: () => output,
    peakRssKiB: 0,
    peakThreads: 0,
    expectedStop: false,
  };
  const sample = setInterval(() => {
    if (!child.pid) return;
    void readFile(`/proc/${child.pid}/status`, 'utf8')
      .then((text) => {
        tool.peakRssKiB = Math.max(
          tool.peakRssKiB,
          Number(text.match(/^VmHWM:\s+(\d+)/m)?.[1] ?? 0),
        );
        tool.peakThreads = Math.max(
          tool.peakThreads,
          Number(text.match(/^Threads:\s+(\d+)/m)?.[1] ?? 0),
        );
      })
      .catch(() => undefined);
  }, 100);
  sample.unref();
  void tool.closed.then(() => clearInterval(sample));
  return tool;
}
async function stop(tool: Tool | undefined): Promise<void> {
  if (!tool) return;
  tool.expectedStop = true;
  if (tool.child.exitCode === null && tool.child.signalCode === null)
    tool.child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      tool.closed,
      new Promise<void>((done) => {
        timer = setTimeout(() => {
          tool.child.kill('SIGKILL');
          done();
        }, 2500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  await tool.closed;
}
function alive(tool: Tool): void {
  assert.equal(tool.child.exitCode, null, tool.output());
  assert.equal(tool.child.signalCode, null, tool.output());
}
function received(tool: Tool): Facts[] {
  const result: Facts[] = [];
  for (const line of tool.output().split('\n')) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(start));
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'event' in parsed
      )
        result.push(parsed as Facts);
    } catch {
      /* Non-feed startup output is not evidence. */
    }
  }
  return result;
}

/** Pure topology translation for an isolated native check, without changing selected transforms. */
export function nativeVectorConfig(
  selected: string,
  evidence: string,
  checkpoints: string,
  feedPort: number,
): string {
  assert(!/["\\\r\n]/.test(evidence));
  assert(Number.isInteger(feedPort) && feedPort > 0 && feedPort < 65536);
  return selected
    .replace(/^data_dir:.*$/m, 'data_dir: ' + JSON.stringify(checkpoints))
    .replaceAll('/evidence/', evidence + '/')
    .replace(/^ {4}address:.*$/m, `    address: 127.0.0.1:${feedPort}`)
    .replace(/^tests:[\s\S]*$/m, '');
}

async function compile(
  files: string[],
  options: ts.CompilerOptions,
): Promise<void> {
  const program = ts.createProgram(files, options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => resolve('.'),
      getNewLine: () => '\n',
    }),
  );
  assert.equal(program.emit().emitSkipped, false);
}

export async function prepareDiagnosticSelections(
  root: string,
  databases: readonly ('mongodb' | 'postgres')[] = ['mongodb', 'postgres'],
  taskFiles: Readonly<Record<string, string>> = {},
) {
  assert(
    root === rootDefault || root.startsWith(rootDefault + '/'),
    'Verification output must remain in its task-owned fixture',
  );
  const compiler = join(root, 'compiler');
  await mkdir(compiler, { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    '{"type":"module","private":true}\n',
  );
  await symlink(resolve('templates'), join(root, 'templates'), 'dir').catch(
    (error) => {
      if (error.code !== 'EEXIST') throw error;
    },
  );
  await compile([resolve('src/recipes/index.ts')], {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    esModuleInterop: true,
    rootDir: resolve('src'),
    outDir: compiler,
    types: ['node'],
  });
  const { recipeCatalog } = (await import(
    pathToFileURL(join(compiler, 'recipes/index.js')).href
  )) as { recipeCatalog: RecipeCatalog };
  const selections = [];
  for (const database of databases) {
    const config: ProjectConfig = {
      schemaVersion: 1,
      project: { name: 'diagnostic-' + database, packageManager: 'npm' },
      capabilities: {},
    };
    const recipes = [
      'foundation.nest',
      'database.' + database,
      'diagnostics.local',
    ].map((id) => {
      const recipe = recipeCatalog.recipes.find((recipe) => recipe.id === id);
      assert(recipe);
      return recipe;
    });
    for (const recipe of recipes)
      config.capabilities[recipe.family] = {
        recipe: recipe.id,
        options: recipe.validateOptions(
          recipe.family === 'diagnostics'
            ? {
                mcp: true,
                vector: true,
                logdy: true,
                sources: [...sources],
                testCapture: true,
              }
            : {},
        ),
      };
    const rendered = await recipeCatalog.render(config, recipes);
    const directory = join(root, 'selected-' + database);
    await mkdir(directory, { recursive: true });
    for (const file of rendered.files) {
      await mkdir(dirname(join(directory, file.path)), { recursive: true });
      await writeFile(join(directory, file.path), file.content);
    }
    for (const [path, content] of Object.entries(taskFiles)) {
      assert(
        /^src\/(?:app\.custom\.module\.ts|run-joined-probe\.ts|modules\/diagnostic-probe\/[a-z-]+\.(?:module|service|controller)\.ts)$/.test(
          path,
        ),
      );
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content);
    }
    await mkdir(join(directory, 'node_modules'), { recursive: true });
    for (const cache of [
      `examples/reference-api${database === 'postgres' ? '-postgres' : ''}/node_modules`,
      'node_modules',
    ]) {
      for (const entry of await readdir(cache, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        await symlink(
          resolve(cache, entry.name),
          join(directory, 'node_modules', entry.name),
          'dir',
        ).catch((error) => {
          if (error.code !== 'EEXIST') throw error;
        });
      }
    }
    const sourceFiles = ts.sys.readDirectory(
      join(directory, 'src'),
      ['.ts'],
      undefined,
      ['**/*.ts'],
    );
    await compile(sourceFiles, {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noUncheckedIndexedAccess: true,
      skipLibCheck: true,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      rootDir: join(directory, 'src'),
      outDir: join(directory, 'dist'),
      types: ['node'],
    });
    const vector = rendered.files.find(
      (file) => file.path === 'ops/diagnostics/vector.yaml',
    )!.content;
    const files = rendered.files.map((file) => ({
      path: file.path,
      sha256: hash(file.content),
    }));
    selections.push({
      database,
      directory,
      config,
      vector,
      files,
      fixtureFiles: Object.entries(taskFiles).map(([path, content]) => ({
        path,
        sha256: hash(content),
      })),
      fingerprint: hash(
        JSON.stringify([
          ...files,
          ...Object.entries(taskFiles).map(([path, content]) => ({
            path,
            sha256: hash(content),
          })),
        ]),
      ),
      load: async <T>(module: string): Promise<T> =>
        import(
          pathToFileURL(join(directory, 'dist', module + '.js')).href
        ) as Promise<T>,
    });
  }
  return selections;
}
type Selection = Awaited<
  ReturnType<typeof prepareDiagnosticSelections>
>[number];

async function privateBindings(ports: readonly number[]): Promise<void> {
  const tcp = await readFile('/proc/net/tcp', 'utf8');
  for (const port of ports) {
    const hex = port.toString(16).toUpperCase().padStart(4, '0');
    const rows = tcp
      .split('\n')
      .filter(
        (row) =>
          row.includes(':' + hex + ' ') && row.trim().split(/\s+/)[3] === '0A',
      );
    assert.equal(rows.length, 1, 'one listener for a task-owned port');
    assert(
      rows[0]!.includes('0100007F:' + hex),
      'native feed/UI listener must be IPv4 loopback',
    );
  }
}

async function stdioQueries(
  selection: Selection,
  evidence: string,
  scope: Facts,
): Promise<void> {
  const sdk = join(
    selection.directory,
    'node_modules/@modelcontextprotocol/sdk/dist/esm',
  );
  type Client = {
    connect(transport: unknown): Promise<void>;
    listTools(): Promise<{
      tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    }>;
    callTool(
      input: Facts,
      schema?: unknown,
      options?: { timeout: number },
    ): Promise<unknown>;
    close(): Promise<void>;
  };
  const { Client } = (await import(
    pathToFileURL(join(sdk, 'client/index.js')).href
  )) as { Client: new (info: Facts) => Client };
  const { StdioClientTransport } = (await import(
    pathToFileURL(join(sdk, 'client/stdio.js')).href
  )) as {
    StdioClientTransport: new (options: Facts) => { close(): Promise<void> };
  };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--max-old-space-size=96',
      join(selection.directory, 'scripts/diagnostics-mcp.mjs'),
    ],
    cwd: selection.directory,
    stderr: 'pipe',
    maxBufferSize: 262144,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      NODE_ENV: 'test',
      EVIDENCE_DIRECTORY: evidence,
      EVIDENCE_MAX_BYTES: '131072',
      EVIDENCE_MAX_FILES: '3',
      EVIDENCE_MAX_AGE_MS: '3600000',
    },
  });
  const client = new Client({
    name: 'selected-native-diagnostics-check',
    version: '1.0.0',
  });
  const resultSchema = z.object({
    isError: z.boolean().optional(),
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 6);
    assert(tools.tools.every((tool) => tool.annotations?.readOnlyHint));
    const result = resultSchema.parse(
      await client.callTool(
        { name: 'tests.getResult', arguments: scope },
        undefined,
        { timeout: 3000 },
      ),
    );
    assert(!result.isError);
    const page = z
      .object({
        events: z.array(
          z.object({ testResult: z.object({ outcome: z.literal('failed') }) }),
        ),
      })
      .parse(JSON.parse(result.content[0]!.text));
    assert(page.events.length > 0);
    assert(!JSON.stringify(result).includes(sentinel));
    for (const input of [
      { name: 'shell.run', arguments: {} },
      { name: 'logs.search', arguments: { path: '../../.env' } },
      { name: 'tests.getResult', arguments: { ...scope, project: 'foreign' } },
    ])
      assert.equal(
        resultSchema.parse(
          await client.callTool(input, undefined, { timeout: 3000 }),
        ).isError,
        true,
      );
  } finally {
    await client.close();
    await transport.close();
  }
}

/** Proxy only a task-owned synthetic Logdy UI to the private Orca container address. */
async function uiProxy(
  uiPort: number,
  address: string,
): Promise<{ server: HttpServer; url: string; close: () => Promise<void> }> {
  assert(
    /^172\.20\.0\.\d+$/.test(address),
    'Only the known private Orca network is permitted',
  );
  const server = httpServer({ maxHeaderSize: 8192 }, (req, res) => {
    const upstream = httpRequest(
      {
        host: '127.0.0.1',
        port: uiPort,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${uiPort}` },
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    const peer = connect({ host: '127.0.0.1', port: uiPort }, () => {
      const headers = Object.entries({
        ...req.headers,
        host: `127.0.0.1:${uiPort}`,
      })
        .map(
          ([key, value]) =>
            key +
            ': ' +
            (Array.isArray(value) ? value.join(', ') : (value ?? '')),
        )
        .join('\r\n');
      peer.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`,
      );
      if (head.length) peer.write(head);
      socket.pipe(peer);
      peer.pipe(socket);
    });
    peer.on('error', () => socket.destroy());
    socket.on('error', () => peer.destroy());
    socket.on('close', () => peer.destroy());
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, address, done);
  });
  const bound = server.address();
  assert(bound && typeof bound === 'object');
  return {
    server,
    url: `http://${address}:${bound.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

export async function runDiagnosticServices(options: {
  vectorBinary: string;
  logdyBinary: string;
  root?: string;
  browserHold?: boolean;
  privateProxyAddress?: string;
}): Promise<DiagnosticServicesReport> {
  const root = resolve(options.root ?? rootDefault);
  assert(
    root === rootDefault || root.startsWith(rootDefault + '/'),
    'Verification output must remain in its task-owned fixture',
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (options.browserHold)
    for (const name of [
      'ui-ready.json',
      'browser-result.json',
      'ui-request-proxy.json',
    ])
      await rm(join(root, name), { force: true });
  const report: DiagnosticServicesReport = {
    passed: false,
    cases: [],
    facts: {
      node: process.version,
      fixture:
        'current source recipes compiled into worker-owned isolated fixture; no shared dist imports',
      databaseEvidence:
        'controlled finite native-operation callbacks; root real native instrumentation is a separate result',
      retention:
        'application-owned JSONL before Vector; Logdy live buffer is not retained history',
      limits: {
        sharedCgroupBytes: 8589934592,
        vectorAddressSpaceBytes: 1073741824,
        logdyAddressSpaceBytes: 2147483648,
        logdyGoSoftHeapBytes: 100663296,
        vectorThreads: 1,
        goMaxProcs: 1,
        liveBufferEvents: 128,
        vectorBufferEvents: 128,
        processCpuSeconds: 180,
        openFiles: 256,
      },
    },
    cleanup: false,
  };
  const allTools: Tool[] = [];
  let closeProxy: (() => Promise<void>) | undefined;
  async function record(name: string, work: () => Promise<void>) {
    process.stdout.write('START ' + name + '\n');
    const started = Date.now();
    try {
      await work();
      report.cases.push({
        name,
        passed: true,
        elapsedMs: Date.now() - started,
      });
      process.stdout.write('PASS ' + name + '\n');
    } catch (error) {
      report.cases.push({
        name,
        passed: false,
        elapsedMs: Date.now() - started,
      });
      throw error;
    }
  }
  async function transform(path: string, name: string) {
    const tool = nativeTool(
      resolve(options.vectorBinary),
      ['--threads', '1', '--color', 'never', 'test', path],
      root,
    );
    allTools.push(tool);
    await tool.closed;
    await writeFile(
      join(root, name + '.log'),
      tool.output().replaceAll(sentinel, '[redacted]'),
      { mode: 0o600 },
    );
    assert.equal(
      tool.child.exitCode,
      0,
      'Actual Vector transform failed: ' + tool.output(),
    );
    const count = (tool.output().match(/\.\.\. passed/g) ?? []).length;
    assert(count >= 28);
    return count;
  }
  try {
    await record(
      'verify exact native tool versions and binary fingerprints',
      async () => {
        const versions: Facts = {};
        for (const [name, binary] of [
          ['vector', options.vectorBinary],
          ['logdy', options.logdyBinary],
        ] as const) {
          const tool = nativeTool(resolve(binary), ['--version'], root);
          allTools.push(tool);
          await tool.closed;
          assert.equal(tool.child.exitCode, 0);
          assert.match(
            tool.output(),
            name === 'vector' ? /vector 0\.62\.0 / : /logdy version 0\.17\.1/,
          );
          versions[name] = {
            version: tool.output().trim(),
            binarySha256: await fileHash(binary),
          };
        }
        report.facts.tools = versions;
      },
    );
    let selections: Selection[] = [];
    await record(
      'compile current recipe source and two complete selected native outputs',
      async () => {
        selections = await prepareDiagnosticSelections(root);
        report.facts.selectedSources = selections.map((selection) => ({
          database: selection.database,
          config: selection.config,
          files: selection.files,
        }));
      },
    );
    const counts: Facts = {};
    await record('actual Vector common transform cases', async () => {
      counts.common = await transform(
        resolve('templates/runtime/common/ops/diagnostics/vector.yaml'),
        'transform-common',
      );
    });
    for (const selection of selections)
      await record(
        'actual Vector selected ' + selection.database + ' transform cases',
        async () => {
          counts[selection.database] = await transform(
            join(selection.directory, 'ops/diagnostics/vector.yaml'),
            'transform-' + selection.database,
          );
        },
      );
    report.facts.transformCases = counts;
    for (const selection of selections) {
      const evidence = join(selection.directory, 'var/evidence');
      const checkpoints = join(selection.directory, 'var/vector');
      await mkdir(checkpoints, { recursive: true });
      const config = {
        directory: evidence,
        maxBytes: 131072,
        maxFiles: 3,
        maxAgeMs: 3600000,
      };
      const { SourceEvidenceService } = await selection.load<{
        SourceEvidenceService: {
          open(
            config: Facts,
            environment: string,
            sources: readonly string[],
          ): Promise<Sink>;
        };
      }>('modules/diagnostics/source-evidence.service');
      const { AppLoggerService } = await selection.load<{
        AppLoggerService: new (
          environment: string,
          sink: Sink,
          destination: { write(value: string): void },
        ) => Logger;
      }>('core/logging/app-logger.service');
      const { DiagnosticReaderService } = await selection.load<{
        DiagnosticReaderService: new (
          config: Facts,
          environment: string,
          options: Facts,
        ) => Reader;
      }>('modules/diagnostics/diagnostic-reader.service');
      const { JobDiagnosticsService } = await selection.load<{
        JobDiagnosticsService: new (logger: Logger) => {
          run<T>(job: string, work: () => Promise<T>): Promise<T>;
        };
      }>('core/diagnostics/job-diagnostics.service');
      const { DatabaseDiagnosticsService } = await selection.load<{
        DatabaseDiagnosticsService: new (
          logger: Logger,
          database: string,
        ) => {
          observe<T>(operation: string, work: () => Promise<T>): Promise<T>;
        };
      }>('core/diagnostics/database-diagnostics.service');
      const { InfrastructureDiagnosticsService } = await selection.load<{
        InfrastructureDiagnosticsService: new (logger: Logger) => {
          sample(): void;
          stop(): void;
        };
      }>('core/diagnostics/infrastructure-diagnostics.service');
      const { TestEvidenceService } = await selection.load<{
        TestEvidenceService: new (sink: Sink) => Capture;
      }>('modules/diagnostics/test-evidence.service');
      const sink = await SourceEvidenceService.open(config, 'test', sources);
      let stdout = '';
      const logger = new AppLoggerService('test', sink, {
        write(value) {
          stdout = (stdout + value).slice(-262144);
        },
      });
      const reader = new DiagnosticReaderService(config, 'test', { sources });
      const jobs = new JobDiagnosticsService(logger);
      const database = new DatabaseDiagnosticsService(
        logger,
        selection.database,
      );
      const infrastructure = new InfrastructureDiagnosticsService(logger);
      const capture = new TestEvidenceService(sink);
      const runId = randomUUID();
      let businessCalls = 0;
      let lastOperation = '';
      const feedPort = await availablePort();
      let uiPort = await availablePort();
      while (uiPort === feedPort) uiPort = await availablePort();
      let vector: Tool | undefined, logdy: Tool | undefined;
      const startLogdy = () => {
        const tool = nativeTool(
          resolve(options.logdyBinary),
          [
            'socket',
            String(feedPort),
            '--ip=127.0.0.1',
            '--ui-ip=127.0.0.1',
            `--port=${uiPort}`,
            '--no-updates',
            '--no-analytics',
            '--max-message-count=128',
            '--fallthrough',
          ],
          selection.directory,
        );
        allTools.push(tool);
        return tool;
      };
      const liveConfig = join(
        selection.directory,
        'ops/diagnostics/vector-native.yaml',
      );
      await writeFile(
        liveConfig,
        nativeVectorConfig(selection.vector, evidence, checkpoints, feedPort),
        { mode: 0o600 },
      );
      const startVector = () => {
        const tool = nativeTool(
          resolve(options.vectorBinary),
          [
            '--config',
            liveConfig,
            '--threads',
            '1',
            '--color',
            'never',
            '--graceful-shutdown-limit-secs',
            '2',
          ],
          selection.directory,
        );
        allTools.push(tool);
        return tool;
      };
      async function emit(operationId: string) {
        lastOperation = operationId;
        await logger.runWithContext(
          { runId, operationId, requestId: randomUUID() },
          async () => {
            logger.record({
              event: 'http.completed',
              severity: 'info',
              route: '/health/ready',
              method: 'GET',
              statusCode: 200,
              message: sentinel,
              headers: { authorization: sentinel },
            });
            await jobs.run('diagnostic-check', async () => {
              businessCalls++;
              return 7;
            });
            await database.observe('transaction', async () => 7); // Explicit controlled operation, never claimed as a real DB.
            infrastructure.sample();
            const result = await capture.capture(
              { runId, operationId },
              async () => ({
                revision: selection.fingerprint,
                dirty: true,
                capabilities: [
                  'foundation.nest',
                  'database.' + selection.database,
                  'diagnostics.local',
                ],
                versions: {
                  node: process.versions.node,
                  vector: '0.62.0',
                  logdy: '0.17.1',
                },
                assertions: [
                  {
                    check: 'invariant',
                    ordinal: 0,
                    outcome: 'failed',
                    code: 'MISMATCH',
                    message: sentinel,
                  },
                ],
                artifacts: [
                  {
                    kind: 'assertion-report',
                    bytes: 2,
                    sha256: hash('{}'),
                    path: sentinel,
                    content: sentinel,
                  },
                ],
              }),
              { flush: () => sink.flush(), stopOwned: async () => true },
            );
            assert.equal(result.outcome, 'failed');
          },
        );
        await sink.flush();
      }
      async function allSources(operationId: string) {
        await until(() => {
          alive(vector!);
          alive(logdy!);
          return sources.every((source) =>
            received(logdy!).some(
              (event) =>
                event.source === source && event.operationId === operationId,
            ),
          );
        }, 'all five sources through native feed');
      }
      try {
        logdy = startLogdy();
        await until(() => listening(feedPort), 'private Logdy feed');
        await until(() => listening(uiPort), 'private Logdy UI');
        vector = startVector();
        await record(
          selection.database +
            ' retained producers -> native Vector -> private Logdy',
          async () => {
            await privateBindings([feedPort, uiPort]);
            const operationId = randomUUID();
            await emit(operationId);
            await allSources(operationId);
            z.object({
              testResult: z.object({
                revision: z.literal(selection.fingerprint),
                versions: z.object({
                  node: z.literal(process.versions.node),
                  vector: z.literal('0.62.0'),
                  logdy: z.literal('0.17.1'),
                }),
              }),
            }).parse(
              received(logdy!).find(
                (event) =>
                  event.operationId === operationId && event.source === 'tests',
              ),
            );
            const page = await reader.search({
              runId,
              operationId,
              limit: 100,
            });
            assert.deepEqual(
              new Set(page.events.map((event) => event.source)),
              new Set(sources),
            );
            assert(!JSON.stringify(page).includes(sentinel));
            assert(!stdout.includes(sentinel));
            assert(!logdy!.output().includes(sentinel));
            assert(
              page.coverage.unavailableSources.includes(
                'vector-live-feed-not-observed',
              ),
            );
          },
        );
        await record(
          selection.database +
            ' collector revalidates foreign and secret-bearing retained inputs',
          async () => {
            const file = (await readdir(evidence)).find((name) =>
              name.endsWith('.jsonl'),
            );
            assert(file);
            const ownId = randomUUID(),
              foreignId = randomUUID();
            const base = {
              version: 1,
              project: selection.config.project.name,
              service: selection.config.project.name,
              environment: 'test',
              timestamp: new Date().toISOString(),
              writerId: randomUUID(),
              sequence: 1,
              source: 'application',
              event: 'operation.completed',
              severity: 'info',
              runId,
            };
            await appendFile(
              join(evidence, file),
              JSON.stringify({
                ...base,
                operationId: ownId,
                token: sentinel,
                message:
                  '$(touch ' +
                  join(selection.directory, 'MALICIOUS_EXECUTED') +
                  ')',
                parameters: [sentinel],
              }) +
                '\n' +
                JSON.stringify({
                  ...base,
                  project: 'foreign-project',
                  operationId: foreignId,
                  token: sentinel,
                }) +
                '\n',
            );
            await until(
              () =>
                received(logdy!).some((event) => event.operationId === ownId),
              'revalidated synthetic retained input',
            );
            assert(
              !received(logdy!).some(
                (event) => event.operationId === foreignId,
              ),
            );
            assert(!logdy!.output().includes(sentinel));
            await assert.rejects(
              readFile(join(selection.directory, 'MALICIOUS_EXECUTED')),
            );
            const page = await reader.search({ runId, limit: 100 });
            assert(!JSON.stringify(page).includes(sentinel));
            assert(page.coverage.gaps.includes('malformed-record'));
          },
        );
        await record(
          selection.database +
            ' viewer termination preserves assertions, retained evidence and actual stdio MCP',
          async () => {
            await stop(logdy);
            logdy = undefined;
            const before = businessCalls;
            const offline = randomUUID();
            await emit(offline);
            assert.equal(businessCalls, before + 1);
            const testResult = await reader.getTestResult({
              runId,
              operationId: offline,
            });
            assert(testResult.events.length > 0);
            assert.equal(
              (testResult.events[0]!.testResult as Facts).outcome,
              'failed',
            );
            await stdioQueries(selection, evidence, {
              runId,
              operationId: offline,
            });
            alive(vector!);
            const started = Date.now();
            for (let count = 0; count < 1000; count++)
              logger.record({
                event: 'operation.completed',
                severity: 'info',
                runId,
                operationId: offline,
                count,
              });
            await sink.flush();
            assert(Date.now() - started < 5000);
            assert(sink.status().application!.dropped > 0);
            assert(sink.status().application!.queued <= 128);
            const page = await reader.search({
              source: 'application',
              event: 'source.status',
              limit: 100,
            });
            assert(page.coverage.gaps.includes('application:writer-dropped'));
            assert(
              page.coverage.unavailableSources.includes(
                'vector-live-feed-not-observed',
              ),
            );
          },
        );
        await record(
          selection.database +
            ' native viewer reconnect resumes live delivery without business retries',
          async () => {
            logdy = startLogdy();
            await until(() => listening(feedPort), 'restarted Logdy feed');
            await until(() => listening(uiPort), 'restarted Logdy UI');
            const heartbeat = randomUUID();
            await until(
              async () => {
                logger.record({
                  event: 'operation.completed',
                  severity: 'info',
                  runId,
                  operationId: heartbeat,
                });
                await sink.flush();
                await delay(250);
                alive(vector!);
                alive(logdy!);
                return received(logdy!).some(
                  (event) => event.operationId === heartbeat,
                );
              },
              'Vector reconnect heartbeat',
              25000,
            );
            const operationId = randomUUID();
            const before = businessCalls;
            await emit(operationId);
            await allSources(operationId);
            assert.equal(businessCalls, before + 1);
          },
        );
        await record(
          selection.database +
            ' collector restart resumes retained input using private checkpoints',
          async () => {
            await stop(vector);
            vector = undefined;
            const operationId = randomUUID();
            await emit(operationId);
            const page = await reader.search({
              runId,
              operationId,
              limit: 100,
            });
            assert(page.events.length >= 5);
            vector = startVector();
            await allSources(operationId);
            await privateBindings([feedPort, uiPort]);
          },
        );
        const coverage = await reader.search({
          runId,
          operationId: lastOperation,
          limit: 100,
        });
        report.facts[selection.database] = {
          runId,
          businessCalls,
          coverage: coverage.coverage,
          feedAddress: '127.0.0.1',
          uiAddress: '127.0.0.1',
          checkpointRestart:
            'observed resumed delivery; no exactly-once or durable viewer replay claim',
        };
        if (options.browserHold && selection.database === 'postgres') {
          await stop(vector);
          vector = undefined; // Release collector before the single browser session.
          const ready = {
            productUrl: `http://127.0.0.1:${uiPort}`,
            proxyUrl: undefined as string | undefined,
            project: selection.config.project.name,
            runId,
            sourceNames: [...sources],
            boundary:
              'product feed/UI remain loopback; optional private Orca proxy exposes only sanitized synthetic fixture UI',
          };
          await writeFile(
            join(root, 'ui-ready.json'),
            JSON.stringify(ready, null, 2) + '\n',
            { mode: 0o600 },
          );
          await until(
            async () => {
              let browserResult: string | undefined;
              try {
                browserResult = await readFile(
                  join(root, 'browser-result.json'),
                  'utf8',
                );
              } catch (error) {
                if (!(
                  error &&
                  typeof error === 'object' &&
                  'code' in error &&
                  error.code === 'ENOENT'
                ))
                  throw error;
              }
              if (browserResult) {
                report.facts.browser = validateDiagnosticBrowserEvidence(
                  JSON.parse(browserResult),
                  selection.config.project.name,
                );
                return true;
              }
              if (options.privateProxyAddress && !closeProxy) {
                let requested = false;
                try {
                  await readFile(join(root, 'ui-request-proxy.json'));
                  requested = true;
                } catch (error) {
                  if (!(
                    error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    error.code === 'ENOENT'
                  ))
                    throw error;
                }
                if (requested) {
                  const created = await uiProxy(
                    uiPort,
                    options.privateProxyAddress,
                  );
                  closeProxy = created.close;
                  ready.proxyUrl = created.url;
                  await writeFile(
                    join(root, 'ui-ready.json'),
                    JSON.stringify(ready, null, 2) + '\n',
                    { mode: 0o600 },
                  );
                }
              }
              alive(logdy!);
              return false;
            },
            'Playwright MCP browser evidence',
            240000,
          );
        }
      } finally {
        if (closeProxy) {
          await closeProxy();
          closeProxy = undefined;
        }
        infrastructure.stop();
        await stop(vector);
        await stop(logdy);
        await sink.close();
        await logger.flush();
      }
    }
    report.passed = true;
  } catch (error) {
    report.error = (
      error instanceof Error ? error.message : 'DIAGNOSTIC_SERVICE_CHECK_FAILED'
    )
      .replaceAll(sentinel, '[redacted]')
      .slice(0, 16384);
  } finally {
    if (closeProxy) await closeProxy();
    for (const tool of allTools) await stop(tool);
    report.facts.processes = allTools.map((tool) => ({
      pid: tool.child.pid,
      peakRssKiB: tool.peakRssKiB,
      peakThreads: tool.peakThreads,
      exitCode: tool.child.exitCode,
      signal: tool.child.signalCode,
    }));
    report.cleanup = allTools.every(
      (tool) => tool.child.exitCode !== null || tool.child.signalCode !== null,
    );
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (report.passed)
      for (const path of ['compiler', 'selected-mongodb', 'selected-postgres'])
        await rm(join(root, path), { recursive: true, force: true });
  }
  return report;
}

/** Test-only additions to the isolated selected app; no product route or provider override. */
export function diagnosticProbeSources(
  runId: string,
): Readonly<Record<string, string>> {
  z.uuid().parse(runId);
  return {
    'src/app.custom.module.ts': `import {Module,type DynamicModule} from '@nestjs/common';
import type {ConfiguredCapabilities} from './core/configured-capabilities.js';
import {DiagnosticProbeModule} from './modules/diagnostic-probe/diagnostic-probe.module.js';
@Module({})
export class AppCustomModule {static register(capabilities:ConfiguredCapabilities):DynamicModule {
if(!capabilities.database||!capabilities.diagnostics)throw new Error('PROBE_CAPABILITY_REQUIRED');
return {module:AppCustomModule,imports:[DiagnosticProbeModule.register(capabilities.database,capabilities.diagnostics)]};}}
`,
    'src/modules/diagnostic-probe/diagnostic-probe.module.ts': `import {Module,type DynamicModule} from '@nestjs/common';
import {DiagnosticProbeController} from './diagnostic-probe.controller.js';
import {DiagnosticProbeService} from './diagnostic-probe.service.js';
@Module({})
export class DiagnosticProbeModule {static register(database:DynamicModule,diagnostics:DynamicModule):DynamicModule {
return {module:DiagnosticProbeModule,imports:[database,diagnostics],providers:[DiagnosticProbeService],controllers:[DiagnosticProbeController]};}}
`,
    'src/modules/diagnostic-probe/diagnostic-probe.controller.ts': `import {Body,Controller,Post,HttpCode,Res,Inject} from '@nestjs/common';
import type {Response} from 'express';
import {z} from 'zod';
import {DiagnosticProbeService} from './diagnostic-probe.service.js';
@Controller('diagnostic-probe')
export class DiagnosticProbeController {
constructor(@Inject(DiagnosticProbeService) private readonly probe:DiagnosticProbeService){}
@Post() @HttpCode(200) async execute(@Body() body:unknown,@Res({passthrough:true}) response:Response) {
z.strictObject({sentinel:z.string().max(512)}).parse(body);
const operationId=z.uuid().parse(response.getHeader('X-Operation-Id'));
await this.probe.execute(operationId);return {status:'ok'};
}}
`,
    'src/modules/diagnostic-probe/diagnostic-probe.service.ts': `import {Injectable,Inject} from '@nestjs/common';
import {sql} from 'drizzle-orm';
import {PostgresDatabase} from '../../core/database/postgres-database.js';
import {JobDiagnosticsService} from '../../core/diagnostics/job-diagnostics.service.js';
import {InfrastructureDiagnosticsService} from '../../core/diagnostics/infrastructure-diagnostics.service.js';
import {TestEvidenceService} from '../diagnostics/test-evidence.service.js';
import {SourceEvidenceService} from '../diagnostics/source-evidence.service.js';
@Injectable()
export class DiagnosticProbeService {
constructor(@Inject(PostgresDatabase) private readonly database:PostgresDatabase,@Inject(JobDiagnosticsService) private readonly jobs:JobDiagnosticsService,@Inject(InfrastructureDiagnosticsService) private readonly infrastructure:InfrastructureDiagnosticsService,@Inject(TestEvidenceService) private readonly tests:TestEvidenceService,@Inject(SourceEvidenceService) private readonly evidence:SourceEvidenceService){}
async execute(operationId:string):Promise<void> {
const result=await this.tests.capture({runId:${JSON.stringify(runId)},operationId},async()=>{
await this.jobs.run('diagnostic-check',async()=>{
const selected=await this.database.run(context=>this.database.context(context).execute(sql\`SELECT 1 AS value\`));
if(selected.rows.length!==1||selected.rows[0]?.value!==1)throw new Error('PROBE_SQL_RESULT_MISMATCH');
this.infrastructure.sample();
});
return {assertions:[{check:'protocol',ordinal:0,outcome:'passed',code:'MATCH'}],artifacts:[]};
},{flush:()=>this.evidence.flush(),stopOwned:async()=>true});
if(result.outcome!=='passed'||!result.resultRetained)throw new Error('PROBE_ASSERTION_FAILED');
}}
`,
    'src/run-joined-probe.ts': `import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Server} from 'node:http';
import {z} from 'zod';
import {createApp,type ApplicationRuntime} from './create-app.js';
import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {TestEvidenceService} from './modules/diagnostics/test-evidence.service.js';
import {SourceEvidenceService} from './modules/diagnostics/source-evidence.service.js';
const control=process.argv[2];if(!control)throw new Error('PROBE_CONTROL_REQUIRED');
let runtime:ApplicationRuntime|undefined;
try {loadSelectedEnvFile();runtime=await createApp(loadConfig());await runtime.app.listen(0,'127.0.0.1');
const server:unknown=runtime.app.getHttpServer();if(!(server instanceof Server))throw new Error('PROBE_SERVER_REQUIRED');
const address=server.address();if(!address||typeof address==='string')throw new Error('PROBE_BIND_FAILED');
await writeFile(join(control,'app-ready.json'),JSON.stringify({port:address.port}),{mode:0o600});
const deadline=Date.now()+240000;let captured=false;
while(Date.now()<deadline) {
if(!captured) {let text:string|undefined;try{text=await readFile(join(control,'capture-request.json'),'utf8');}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}
if(text){const request=z.strictObject({operationId:z.uuid(),httpStatus:z.literal(200),response:z.strictObject({status:z.literal('ok')})}).parse(JSON.parse(text));
const tests=runtime.app.get(TestEvidenceService);const evidence=runtime.app.get(SourceEvidenceService);
const result=await tests.capture({runId:${JSON.stringify(runId)},operationId:request.operationId},async()=>{
if(request.httpStatus!==200||request.response.status!=='ok')throw new Error('HTTP_ASSERTION_FAILED');
return {assertions:[{check:'http-status',ordinal:1,outcome:'passed',code:'MATCH'}],artifacts:[]};
},{flush:()=>evidence.flush(),stopOwned:async()=>true});
await writeFile(join(control,'capture-result.json'),JSON.stringify(result),{mode:0o600});captured=true;}}
try{await readFile(join(control,'stop-request'));break;}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error;}
await new Promise<void>(done=>setTimeout(done,50));
}
}catch{console.error('JOINED_PROBE_FAILED');process.exitCode=1;}finally{await runtime?.close();}
`,
  };
}

export async function runJoinedDiagnosticServices(options: {
  vectorBinary: string;
  logdyBinary: string;
  browserHold?: boolean;
}): Promise<DiagnosticServicesReport> {
  const root = join(rootDefault, 'joined');
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (const name of [
    'app-ready.json',
    'capture-request.json',
    'capture-result.json',
    'stop-request',
    'ui-ready.json',
    'browser-result.json',
  ])
    await rm(join(root, name), { force: true });
  const runId = randomUUID();
  const label = runId;
  const name = 'vcli-diag-join-' + randomBytes(5).toString('hex');
  const image =
    'postgres@sha256:f45d631d050c2fe068f384ed6c4faac506e9cd7f4da605ce703648e4b0985848';
  const password = randomBytes(32).toString('hex');
  const bodySentinel = 'JOINED_HTTP_BODY_PRIVATE_SENTINEL';
  const credentialSentinel = 'JOINED_HEADER_PRIVATE_SENTINEL';
  const privateValues = [password, bodySentinel, credentialSentinel];
  const scrub = (value: string) =>
    privateValues.reduce(
      (text, secret) => text.replaceAll(secret, '[redacted]'),
      value,
    );
  const report: DiagnosticServicesReport = {
    passed: false,
    cases: [],
    facts: {
      runId,
      image,
      profile:
        'current-source foundation/PostgreSQL/all diagnostics; fixture-only probe imports actual configured modules',
      database:
        'real task-owned PostgreSQL; actual generated createApp/native transaction observation',
      limits: {
        databaseMemoryBytes: 201326592,
        cpus: 0.5,
        pids: 256,
        cgroupParent: 'orca.slice',
        noPublishedPorts: true,
      },
    },
    cleanup: false,
  };
  const tools: Tool[] = [];
  let container: string | undefined;
  let app: ChildProcess | undefined;
  let appOutput = '';
  let appClosed: Promise<void> | undefined;
  const privateEnv = join(root, 'private.env'),
    pgEnv = join(root, 'postgres.env');
  async function docker(args: string[], required = true): Promise<string> {
    return new Promise((done, reject) => {
      const child = spawn('/usr/bin/sudo', ['-n', 'docker', ...args], {
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      const capture = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-32768);
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || !required) done(output.trim());
        else
          reject(
            new Error('Task Docker ' + args[0] + ' failed: ' + scrub(output)),
          );
      });
    });
  }
  async function step(title: string, work: () => Promise<void>) {
    const start = Date.now();
    process.stdout.write('JOIN START ' + title + '\n');
    try {
      await work();
      report.cases.push({
        name: title,
        passed: true,
        elapsedMs: Date.now() - start,
      });
      process.stdout.write('JOIN PASS ' + title + '\n');
    } catch (error) {
      report.cases.push({
        name: title,
        passed: false,
        elapsedMs: Date.now() - start,
      });
      throw error;
    }
  }
  async function nodeCommand(
    file: string,
    selection: Selection,
  ): Promise<string> {
    return new Promise((done, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=192', file],
        {
          cwd: selection.directory,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            NODE_ENV: 'test',
            APP_ENV_FILE: privateEnv,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      const capture = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-131072);
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) done(scrub(output));
        else
          reject(new Error('Selected schema release failed: ' + scrub(output)));
      });
    });
  }
  try {
    const selections = await prepareDiagnosticSelections(
      root,
      ['postgres'],
      diagnosticProbeSources(runId),
    );
    const selection = selections[0];
    assert(selection);
    report.facts.selection = {
      config: selection.config,
      renderedFiles: selection.files,
      fixtureOnlyFiles: selection.fixtureFiles,
      fingerprint: selection.fingerprint,
    };
    await step(
      'reuse cached PostgreSQL image and create one capped private task database',
      async () => {
        const digests = JSON.parse(
          await docker([
            'image',
            'inspect',
            image,
            '--format',
            '{{json .RepoDigests}}',
          ]),
        ) as unknown;
        report.facts.imageDigests = digests;
        await writeFile(
          pgEnv,
          `POSTGRES_USER=fixture\nPOSTGRES_DB=fixture\nPOSTGRES_PASSWORD=${password}\n`,
          { mode: 0o600 },
        );
        container = await docker([
          'run',
          '-d',
          '--pull',
          'never',
          '--name',
          name,
          '--label',
          'vcli.diagnostic-join=' + label,
          '--network',
          'my-first-project-orcaserver-bwwu6y_default',
          '--cgroup-parent',
          'orca.slice',
          '--memory',
          '192m',
          '--cpus',
          '0.5',
          '--pids-limit',
          '256',
          '--config-file',
          pgEnv,
          image,
          'postgres',
          '-c',
          'shared_buffers=32MB',
          '-c',
          'max_connections=16',
          '-c',
          'work_mem=1MB',
        ]);
        assert.match(container, /^[a-f0-9]{64}$/);
        await until(
          async () =>
            (
              await docker(
                [
                  'exec',
                  container!,
                  'pg_isready',
                  '-U',
                  'fixture',
                  '-d',
                  'fixture',
                ],
                false,
              )
            ).includes('accepting connections'),
          'real task PostgreSQL ready',
          30000,
        );
        const address = await docker([
          'inspect',
          container,
          '--format',
          '{{(index .NetworkSettings.Networks "my-first-project-orcaserver-bwwu6y_default").IPAddress}}',
        ]);
        assert.match(address, /^172\.20\.[0-9.]+$/);
        const url = `postgresql://fixture:${password}@${address}:5432/fixture`;
        privateValues.push(url);
        await writeFile(
          privateEnv,
          `NODE_ENV=test\nDATABASE_URL=${url}\nEVIDENCE_DIRECTORY=${join(selection.directory, 'var/evidence')}\nEVIDENCE_MAX_BYTES=131072\nEVIDENCE_MAX_FILES=3\nEVIDENCE_MAX_AGE_MS=3600000\n`,
          { mode: 0o600 },
        );
        const controls = z
          .object({
            memory: z.literal(201326592),
            cpus: z.literal(500000000),
            pids: z.literal(256),
            parent: z.literal('orca.slice'),
            ports: z.record(z.string(), z.unknown()).nullable(),
          })
          .parse(
            JSON.parse(
              await docker([
                'inspect',
                container,
                '--format',
                '{"memory":{{.HostConfig.Memory}},"cpus":{{.HostConfig.NanoCpus}},"pids":{{.HostConfig.PidsLimit}},"parent":"{{.HostConfig.CgroupParent}}","ports":{{json .HostConfig.PortBindings}}}',
              ]),
            ),
          );
        assert(!controls.ports || Object.keys(controls.ports).length === 0);
        report.facts.databaseControls = controls;
        report.facts.databaseVersion = await docker([
          'exec',
          container,
          'postgres',
          '--version',
        ]);
        report.facts.databaseOs = await docker([
          'exec',
          container,
          'cat',
          '/etc/os-release',
        ]);
      },
    );
    await step(
      'explicit selected schema release and actual generated app boot',
      async () => {
        report.facts.schemaRelease = await nodeCommand(
          join(selection.directory, 'dist/initialize-database.js'),
          selection,
        );
        app = spawn(
          process.execPath,
          [
            '--max-old-space-size=256',
            join(selection.directory, 'dist/run-joined-probe.js'),
            root,
          ],
          {
            cwd: selection.directory,
            env: {
              PATH: process.env.PATH ?? '/usr/bin:/bin',
              NODE_ENV: 'test',
              APP_ENV_FILE: privateEnv,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        const collect = (chunk: Buffer) => {
          appOutput = (appOutput + chunk.toString('utf8')).slice(-262144);
        };
        app.stdout?.on('data', collect);
        app.stderr?.on('data', collect);
        appClosed = new Promise((done) => app!.once('close', () => done()));
        await until(async () => {
          assert.equal(app!.exitCode, null, scrub(appOutput));
          try {
            return z
              .object({ port: z.number().int().positive() })
              .safeParse(
                JSON.parse(
                  await readFile(join(root, 'app-ready.json'), 'utf8'),
                ),
              ).success;
          } catch {
            return false;
          }
        }, 'actual selected Nest boot');
      },
    );
    const ready = z
      .object({ port: z.number().int().positive() })
      .parse(JSON.parse(await readFile(join(root, 'app-ready.json'), 'utf8')));
    const evidence = join(selection.directory, 'var/evidence'),
      checkpoints = join(root, 'checkpoints');
    await mkdir(checkpoints, { recursive: true });
    const feedPort = await availablePort();
    let uiPort = await availablePort();
    while (uiPort === feedPort) uiPort = await availablePort();
    let logdy: Tool | undefined, vector: Tool | undefined;
    let operationId = '',
      requestId = '';
    await step(
      'actual HTTP probe executes actual selected native transaction and captures assertions',
      async () => {
        requestId = randomUUID();
        const response = await fetch(
          `http://127.0.0.1:${ready.port}/api/diagnostic-probe`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-request-id': requestId,
              'x-probe-credential': credentialSentinel,
            },
            body: JSON.stringify({ sentinel: bodySentinel }),
            signal: AbortSignal.timeout(10000),
          },
        );
        assert.equal(response.status, 200);
        const body = z
          .strictObject({ status: z.literal('ok') })
          .parse(await response.json());
        operationId = z.uuid().parse(response.headers.get('x-operation-id'));
        assert.equal(response.headers.get('x-request-id'), requestId);
        await writeFile(
          join(root, 'capture-request.json'),
          JSON.stringify({
            operationId,
            httpStatus: response.status,
            response: body,
          }),
          { mode: 0o600 },
        );
        await until(async () => {
          try {
            return z
              .object({
                outcome: z.literal('passed'),
                logsComplete: z.literal(true),
                resultRetained: z.literal(true),
              })
              .safeParse(
                JSON.parse(
                  await readFile(join(root, 'capture-result.json'), 'utf8'),
                ),
              ).success;
          } catch {
            return false;
          }
        }, 'actual HTTP assertion metadata flush');
        report.facts.correlation = {
          runId,
          requestId,
          operationId,
          httpStatus: response.status,
          response: body,
        };
      },
    );
    const { DiagnosticReaderService } = await selection.load<{
      DiagnosticReaderService: new (
        config: Facts,
        environment: string,
        options: Facts,
      ) => Reader;
    }>('modules/diagnostics/diagnostic-reader.service');
    const reader = new DiagnosticReaderService(
      { directory: evidence, maxBytes: 131072, maxFiles: 3, maxAgeMs: 3600000 },
      'test',
      { sources },
    );
    let expectedEvents: Facts[] = [];
    await step(
      'joined retained HTTP job database process and test evidence shares exact operation',
      async () => {
        const page = await reader.search({ operationId, limit: 100 });
        expectedEvents = page.events;
        assert.deepEqual(
          new Set(page.events.map((event) => event.source)),
          new Set(sources),
        );
        for (const event of page.events.filter(
          (event) => event.source !== 'tests',
        ))
          assert.equal(event.requestId, requestId);
        assert(
          page.events.some(
            (event) =>
              event.event === 'database.completed' &&
              event.databaseOperation === 'transaction' &&
              event.database === 'postgres',
          ),
        );
        const results = await reader.getTestResult({ runId, operationId });
        const assertions = results.events.flatMap(
          (event) =>
            z
              .object({
                testResult: z.object({
                  assertions: z.array(
                    z.object({
                      check: z.string(),
                      outcome: z.literal('passed'),
                    }),
                  ),
                }),
              })
              .parse(event).testResult.assertions,
        );
        assert(assertions.some((value) => value.check === 'protocol'));
        assert(assertions.some((value) => value.check === 'http-status'));
        for (const forbidden of [...privateValues, 'SELECT 1', 'postgresql://'])
          assert(!JSON.stringify(page).includes(forbidden));
        report.facts.joinedEvents = page.events;
        report.facts.coverage = page.coverage;
      },
    );
    await step(
      'actual retained files through selected Vector to private native Logdy',
      async () => {
        const configPath = join(root, 'vector-native.yaml');
        await writeFile(
          configPath,
          nativeVectorConfig(selection.vector, evidence, checkpoints, feedPort),
          { mode: 0o600 },
        );
        logdy = nativeTool(
          resolve(options.logdyBinary),
          [
            'socket',
            String(feedPort),
            '--ip=127.0.0.1',
            '--ui-ip=127.0.0.1',
            `--port=${uiPort}`,
            '--no-updates',
            '--no-analytics',
            '--max-message-count=128',
            '--fallthrough',
          ],
          root,
        );
        tools.push(logdy);
        await until(() => listening(feedPort), 'joined Logdy feed');
        await until(() => listening(uiPort), 'joined Logdy UI');
        vector = nativeTool(
          resolve(options.vectorBinary),
          [
            '--config',
            configPath,
            '--threads',
            '1',
            '--color',
            'never',
            '--graceful-shutdown-limit-secs',
            '2',
          ],
          root,
        );
        tools.push(vector);
        await until(() => {
          alive(vector!);
          alive(logdy!);
          return expectedEvents.every((event) =>
            received(logdy!).some(
              (actual) =>
                actual.writerId === event.writerId &&
                actual.sequence === event.sequence,
            ),
          );
        }, 'exact retained writer/sequence records in Logdy');
        await privateBindings([feedPort, uiPort]);
        for (const forbidden of [...privateValues, 'SELECT 1', 'postgresql://'])
          assert(!logdy.output().includes(forbidden));
        report.facts.viewerEvents = received(logdy).filter(
          (event) => event.operationId === operationId,
        );
      },
    );
    await step(
      'generated stdio MCP returns the same real joined operation and SQL/HTTP assertions',
      async () => {
        const sdk = join(
          selection.directory,
          'node_modules/@modelcontextprotocol/sdk/dist/esm',
        );
        type Client = {
          connect(transport: unknown): Promise<void>;
          callTool(
            input: Facts,
            schema?: unknown,
            options?: { timeout: number },
          ): Promise<unknown>;
          close(): Promise<void>;
        };
        const { Client } = (await import(
          pathToFileURL(join(sdk, 'client/index.js')).href
        )) as { Client: new (info: Facts) => Client };
        const { StdioClientTransport } = (await import(
          pathToFileURL(join(sdk, 'client/stdio.js')).href
        )) as {
          StdioClientTransport: new (options: Facts) => {
            close(): Promise<void>;
          };
        };
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [
            '--max-old-space-size=96',
            join(selection.directory, 'scripts/diagnostics-mcp.mjs'),
          ],
          cwd: selection.directory,
          stderr: 'pipe',
          maxBufferSize: 262144,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            NODE_ENV: 'test',
            EVIDENCE_DIRECTORY: evidence,
            EVIDENCE_MAX_BYTES: '131072',
            EVIDENCE_MAX_FILES: '3',
          },
        });
        const client = new Client({
          name: 'joined-native-diagnostic-check',
          version: '1.0.0',
        });
        try {
          await client.connect(transport);
          const envelope = z.object({
            isError: z.boolean().optional(),
            content: z.array(
              z.object({ type: z.literal('text'), text: z.string() }),
            ),
          });
          const timeline = envelope.parse(
            await client.callTool(
              {
                name: 'operations.timeline',
                arguments: { operationId, limit: 100 },
              },
              undefined,
              { timeout: 3000 },
            ),
          );
          assert(!timeline.isError);
          const events = z
            .object({ events: z.array(z.record(z.string(), z.unknown())) })
            .parse(JSON.parse(timeline.content[0]!.text)).events;
          assert(
            expectedEvents.every((event) =>
              events.some(
                (actual) =>
                  actual.writerId === event.writerId &&
                  actual.sequence === event.sequence,
              ),
            ),
          );
          const tests = envelope.parse(
            await client.callTool(
              { name: 'tests.getResult', arguments: { runId, operationId } },
              undefined,
              { timeout: 3000 },
            ),
          );
          assert(!tests.isError);
          assert(
            z
              .object({ events: z.array(z.unknown()).min(2) })
              .safeParse(JSON.parse(tests.content[0]!.text)).success,
          );
          for (const forbidden of [
            ...privateValues,
            'SELECT 1',
            'postgresql://',
          ])
            assert(!JSON.stringify([timeline, tests]).includes(forbidden));
          report.facts.mcp = {
            timelineEventCount: events.length,
            exactWriterSequencesMatched: true,
            sqlAndHttpAssertions: true,
          };
        } finally {
          await client.close();
          await transport.close();
        }
      },
    );
    if (options.browserHold) {
      await stop(vector);
      await writeFile(
        join(root, 'ui-ready.json'),
        JSON.stringify({
          productUrl: `http://127.0.0.1:${uiPort}`,
          project: selection.config.project.name,
          runId,
          operationId,
          requestId,
          sources,
        }),
        { mode: 0o600 },
      );
      await until(
        async () => {
          try {
            const value = JSON.parse(
              await readFile(join(root, 'browser-result.json'), 'utf8'),
            );
            report.facts.browser = validateDiagnosticBrowserEvidence(
              value,
              selection.config.project.name,
            );
            return true;
          } catch (error) {
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ENOENT'
            )
              return false;
            throw error;
          }
        },
        'joined real-source Playwright UI',
        180000,
      );
    }
    for (const forbidden of privateValues)
      assert(!appOutput.includes(forbidden));
    report.passed = true;
  } catch (error) {
    report.error = scrub(
      error instanceof Error ? error.message : 'JOINED_NATIVE_CHECK_FAILED',
    ).slice(0, 16384);
  } finally {
    await writeFile(join(root, 'stop-request'), 'stop', { mode: 0o600 });
    if (app && appClosed) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          appClosed,
          new Promise<void>((done) => {
            timer = setTimeout(() => {
              app!.kill('SIGTERM');
              done();
            }, 4000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
      await appClosed;
    }
    for (const tool of tools) await stop(tool);
    const owner = await docker(
      [
        'inspect',
        container ?? name,
        '--format',
        '{{index .Config.Labels "vcli.diagnostic-join"}}',
      ],
      false,
    );
    if (owner === label) {
      report.facts.containerRemoved = container ?? name;
      await docker(['stop', '--time', '5', container ?? name]);
      await docker(['rm', '--volumes', container ?? name]);
    }
    await rm(privateEnv, { force: true });
    await rm(pgEnv, { force: true });
    report.cleanup =
      (!app || app.exitCode !== null || app.signalCode !== null) &&
      tools.every(
        (tool) =>
          tool.child.exitCode !== null || tool.child.signalCode !== null,
      );
    report.facts.processes = tools.map((tool) => ({
      pid: tool.child.pid,
      peakRssKiB: tool.peakRssKiB,
      peakThreads: tool.peakThreads,
      exitCode: tool.child.exitCode,
      signal: tool.child.signalCode,
    }));
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600 },
    );
    if (report.passed)
      for (const path of ['compiler', 'selected-postgres', 'checkpoints'])
        await rm(join(root, path), { recursive: true, force: true });
  }
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  assert(
    process.env.VECTOR_BINARY && process.env.LOGDY_BINARY,
    'Set reviewed VECTOR_BINARY and LOGDY_BINARY paths',
  );
  const report = await runDiagnosticServices({
    vectorBinary: process.env.VECTOR_BINARY,
    logdyBinary: process.env.LOGDY_BINARY,
    browserHold: process.env.DIAGNOSTIC_BROWSER_HOLD === '1',
    privateProxyAddress: process.env.DIAGNOSTIC_PRIVATE_PROXY_ADDRESS,
  });
  process.stdout.write(
    JSON.stringify({
      passed: report.passed,
      cases: report.cases,
      cleanup: report.cleanup,
      error: report.error,
    }) + '\n',
  );
  if (!report.passed) process.exitCode = 1;
}

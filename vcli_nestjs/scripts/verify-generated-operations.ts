import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import net from 'node:net';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  clearGeneratedRedisRates,
  generatedRedisRatePrefix,
  redactGeneratedRedisOutput,
  requireGeneratedRedisTestUrl,
  withGeneratedRedisClient,
} from './generated-redis-fixture.ts';

const nodeDigest =
  'node@sha256:18a166e2d50578afe933434857ed2d9059bd1aa398a223e9c89eb4302354f079';
const postgresDigest =
  'postgres@sha256:f45d631d050c2fe068f384ed6c4faac506e9cd7f4da605ce703648e4b0985848';
const network = 'my-first-project-orcaserver-bwwu6y_default';
export const operationBuildLimits = Object.freeze({
  memory: 805306368,
  cpuQuota: 100000,
  cpuPeriod: 100000,
  cgroupParent: 'orca.slice',
  nproc: 256,
  hardBuildPids: false,
});
export function buildOperationArguments(
  project: string,
  image: string,
  sourceCommit: string,
): string[] {
  if (
    !/^[a-f0-9]{40}$/.test(sourceCommit) ||
    !/^vcli-operations-[a-f0-9]{10}$/.test(image)
  )
    throw new Error('INVALID_OPERATION_IMAGE_IDENTITY');
  return [
    'build',
    '--pull=false',
    '--force-rm',
    '--cgroup-parent',
    operationBuildLimits.cgroupParent,
    '--memory',
    '768m',
    '--memory-swap',
    '768m',
    '--cpu-quota',
    '100000',
    '--cpu-period',
    '100000',
    '--ulimit',
    'nproc=256:256',
    '--label',
    'io.vcli.operations=' + image,
    '--build-arg',
    'VCLI_SOURCE_COMMIT=' + sourceCommit,
    '-t',
    image,
    '-f',
    'ops/Dockerfile',
    project,
  ];
}
export function assertDownloadBudget(
  postgresBytes: number,
  npmBytes: number,
): number {
  assert.ok(Number.isSafeInteger(postgresBytes) && postgresBytes > 0);
  assert.ok(Number.isSafeInteger(npmBytes) && npmBytes > 0);
  const budget = postgresBytes + Math.ceil(npmBytes * 1.2) + 10000000;
  if (budget > 500000000) throw new Error('DOWNLOAD_AUTHORIZATION_REQUIRED');
  return budget;
}
export function validateOperationImageAlias(
  existing: string,
  expected: string,
): void {
  if (existing && existing !== expected)
    throw new Error('EXISTING_IMAGE_ALIAS_CONFLICT');
}
export function redactOperationOutput(
  input: string,
  secrets: readonly string[],
): string {
  for (const secret of [...secrets].sort((a, b) => b.length - a.length))
    if (secret.length >= 12) input = input.replaceAll(secret, '[REDACTED]');
  return input.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[REDACTED-JWT]',
  );
}
async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}
async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  label: string,
  timeout = 45000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await probe();
    if (result !== undefined) return result;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(label + '_TIMEOUT');
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}

/** Real isolated acceptance. No task resource is discovered or deleted by a broad name/cache scan. */
export async function verifyGeneratedOperations(): Promise<void> {
  const hostRedisUrl = requireGeneratedRedisTestUrl(process.env);
  const containerRedisUrl =
    process.env.VCLI_GENERATED_REDIS_CONTAINER_TEST_URL === undefined
      ? hostRedisUrl
      : requireGeneratedRedisTestUrl(
          process.env,
          'VCLI_GENERATED_REDIS_CONTAINER_TEST_URL',
        );
  const redisUrls = [hostRedisUrl, containerRedisUrl];
  const repository = resolve('.'),
    evidence = join(repository, 'var/cli-evidence/operations');
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const workspace =
    process.env.VCLI_OPERATIONS_WORKSPACE ??
    (await mkdtemp('/tmp/vcli-operations-gate-'));
  assert.ok(workspace.startsWith('/tmp/vcli-operations-gate-'));
  const stateFile = join(workspace, 'gate-state.json');
  let saved: Record<string, unknown> | undefined;
  try {
    saved = object(JSON.parse(await readFile(stateFile, 'utf8')));
  } catch {
    // No saved task state means a fresh isolated gate.
  }
  if (saved && saved.redisFixtureVersion !== 1)
    throw new Error('OPERATIONS_REDIS_FIXTURE_VERSION_MISMATCH');
  const suffix = saved ? text(saved.suffix) : randomBytes(5).toString('hex'),
    name = 'operations-' + suffix,
    image = 'vcli-operations-' + suffix;
  const project = join(workspace, 'app'),
    pack = join(workspace, 'pack'),
    tool = join(workspace, 'tool');
  const privateValues: string[] = [];
  const records: {
    name: string;
    exitCode: number | null;
    elapsedMs: number;
  }[] = saved ? (saved.records as typeof records) : [];
  const facts: Record<string, unknown> = saved
    ? object(saved.facts)
    : {
        workspace,
        suffix,
        sourceCommit: '3'.repeat(40),
        buildLimits: operationBuildLimits,
        fixtureBoundary:
          'Existing private Orca network; only task-owned DB/API containers attached; no shared memberships changed.',
      };
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    NO_COLOR: '1',
    NODE_OPTIONS: '--max-old-space-size=512',
  };
  const containers = new Set<string>();
  const volumes = new Set<string>();
  let dev: ChildProcess | undefined;
  let devClosed: Promise<number | null> | undefined;
  let rateApiContainer: string | undefined;
  let privateConfigDirectory: string | undefined;
  let redisCleanupNeeded = false;
  let redisCleanupFailed = false;
  let success = false;
  let sentinel: ReturnType<typeof createServer> | undefined;
  function safeOutput(input: string): string {
    return redactOperationOutput(
      redactGeneratedRedisOutput(input, redisUrls),
      privateValues,
    );
  }
  async function save(): Promise<void> {
    await writeFile(
      stateFile,
      JSON.stringify(
        { suffix, records, facts, redisFixtureVersion: 1 },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(
      join(evidence, 'results.json'),
      JSON.stringify(
        { status: success ? 'passed' : 'incomplete', records, facts },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  function passed(label: string): boolean {
    return records.some(
      (record) => record.name === label && record.exitCode === 0,
    );
  }
  async function run(
    label: string,
    command: string,
    args: string[],
    cwd = repository,
    extra: NodeJS.ProcessEnv = {},
    timeout = 180000,
    expected = 0,
    input?: string,
  ): Promise<string> {
    const start = Date.now();
    const result = await new Promise<{
      status: number | null;
      output: string;
      stdout: string;
      error?: Error;
    }>((done) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...environment, ...extra },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let stdout = '';
      let exceeded = false;
      const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (data) => {
          if (output.length > 16000000) {
            exceeded = true;
            child.kill('SIGTERM');
          } else {
            output += String(data);
            if (stream === child.stdout) stdout += String(data);
          }
        });
      child.once('error', (error) => {
        clearTimeout(timer);
        done({ status: null, output, stdout, error });
      });
      child.once('close', (status) => {
        clearTimeout(timer);
        done({
          status,
          output,
          stdout,
          ...(exceeded ? { error: new Error('OUTPUT_LIMIT') } : {}),
        });
      });
      child.stdin.end(input);
    });
    records.push({
      name: label,
      exitCode: result.status,
      elapsedMs: Date.now() - start,
    });
    await writeFile(join(evidence, label + '.log'), safeOutput(result.output), {
      mode: 0o600,
    });
    await save();
    process.stdout.write(
      label + ': ' + (result.status === expected ? 'passed' : 'FAILED') + '\n',
    );
    assert.ifError(result.error);
    assert.equal(result.status, expected, 'See sanitized ' + label + '.log');
    return result.stdout;
  }
  function docker(args: string[], required = true): string {
    const result = spawnSync('sudo', ['-n', 'docker', ...args], {
      env: environment,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 2000000,
    });
    if (required) {
      assert.ifError(result.error);
      assert.equal(result.status, 0, 'NATIVE_OPERATION_FAILED');
    }
    return result.status === 0 ? result.stdout.trim() : '';
  }
  async function check(
    label: string,
    work: () => Promise<void>,
  ): Promise<void> {
    const start = Date.now();
    try {
      await work();
      records.push({ name: label, exitCode: 0, elapsedMs: Date.now() - start });
      process.stdout.write(label + ': passed\n');
      await save();
    } catch (error) {
      records.push({ name: label, exitCode: 1, elapsedMs: Date.now() - start });
      await save();
      throw error;
    }
  }
  let localCli = '';
  async function cli(
    label: string,
    args: string[],
    extra: NodeJS.ProcessEnv = {},
    expected = 0,
  ): Promise<Record<string, unknown>> {
    const output = await run(
      label,
      process.execPath,
      [localCli, ...args, '--json'],
      project,
      { ...extra },
      180000,
      expected,
    );
    const value = object(JSON.parse(output));
    assert.equal(value.schemaVersion, 1);
    assert.equal(output.includes(workspace), false, 'PUBLIC_CLI_PATH_LEAK');
    return value;
  }
  const composeEnv: NodeJS.ProcessEnv = { VCLI_CGROUP_PARENT: 'orca.slice' };
  async function databaseUp(
    environmentName: 'development' | 'test',
  ): Promise<string> {
    await cli(
      'services-' + environmentName + '-up',
      ['services', 'up', '--environment', environmentName],
      composeEnv,
    );
    const ids = docker([
      'ps',
      '-q',
      '--filter',
      'label=com.docker.compose.project=' + name + '-' + environmentName,
    ]);
    assert.match(ids, /^[a-f0-9]+$/);
    containers.add(ids);
    const inspect = object(
      JSON.parse(docker(['inspect', '--format', '{{json .HostConfig}}', ids])),
    );
    assert.equal(inspect.CgroupParent, 'orca.slice');
    assert.equal(inspect.Memory, 536870912);
    assert.equal(inspect.PidsLimit, 128);
    const volumeName = name + '-' + environmentName + '-database-data';
    volumes.add(volumeName);
    const attached = docker([
      'inspect',
      '--format',
      '{{json .NetworkSettings.Networks}}',
      ids,
    ]);
    if (!Object.hasOwn(object(JSON.parse(attached)), network))
      docker(['network', 'connect', network, ids]);
    await cli(
      'services-' + environmentName + '-status',
      ['services', 'status', '--environment', environmentName],
      composeEnv,
    );
    return ids;
  }
  async function databaseDown(
    environmentName: 'development' | 'test',
  ): Promise<void> {
    await cli(
      'services-' + environmentName + '-down',
      ['services', 'down', '--environment', environmentName],
      composeEnv,
    );
  }
  try {
    if (!passed('pack')) {
      await mkdir(pack, { recursive: true });
      const packed = JSON.parse(
        await run('pack', 'npm', [
          'pack',
          '--ignore-scripts',
          '--pack-destination',
          pack,
          '--json',
        ]),
      );
      const entry = object((packed as unknown[])[0]);
      const tarball = join(pack, text(entry.filename));
      facts.artifact = {
        name: entry.filename,
        bytes: entry.size,
        sha256: createHash('sha256')
          .update(await readFile(tarball))
          .digest('hex'),
      };
      await save();
    }
    const artifact = object(facts.artifact),
      tarball = join(pack, text(artifact.name));
    assert.equal(
      createHash('sha256')
        .update(await readFile(tarball))
        .digest('hex'),
      artifact.sha256,
    );
    if (!passed('install-packed-cli')) {
      await mkdir(tool, { recursive: true });
      await writeFile(
        join(tool, 'package.json'),
        JSON.stringify({
          name: 'operations-consumer',
          private: true,
          dependencies: { '@vcli/cli': 'file:' + tarball },
        }),
      );
      await run(
        'install-packed-cli',
        'npm',
        ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
        tool,
      );
    }
    const cliEntry = join(tool, 'node_modules/@vcli/cli/bin/vcli.mjs');
    if (!passed('generate'))
      await run(
        'generate',
        process.execPath,
        [
          cliEntry,
          'init',
          project,
          '--name',
          name,
          '--preset',
          'api',
          '--database',
          'postgres',
          '--auth',
          'local',
          '--local-auth-profile',
          'full',
          '--mail',
          'smtp',
          '--storage',
          'local',
          '--media',
          '--realtime',
          'socket-io',
          '--notes',
          '--deploy',
          'dokploy',
          '--yes',
          '--skip-install',
          '--json',
        ],
        workspace,
      );
    if (!passed('install-generated'))
      await run(
        'install-generated',
        process.execPath,
        [cliEntry, '--project', project, 'install', '--offline', '--json'],
        workspace,
      );
    localCli = join(project, 'node_modules/@vcli/cli/bin/vcli.mjs');
    if (!passed('check-generated')) await cli('check-generated', ['check']);
    if (!passed('build-generated'))
      await run('build-generated', 'npm', ['run', 'build'], project);
    if (!passed('generated-tests'))
      await run('generated-tests', 'npm', ['test'], project);
    if (!passed('download-estimate'))
      await check('download-estimate', async () => {
        const lock = object(
            JSON.parse(
              await readFile(join(project, 'package-lock.json'), 'utf8'),
            ),
          ),
          packages = object(lock.packages),
          seen = new Set<string>();
        let npmBytes = 0;
        let registryHeads = 0;
        for (const item of Object.values(packages)) {
          const entry = object(item);
          if (
            typeof entry.resolved === 'string' &&
            entry.resolved.startsWith('file:')
          )
            continue;
          if (typeof entry.integrity !== 'string' || seen.has(entry.integrity))
            continue;
          seen.add(entry.integrity);
          const token = entry.integrity.split(' ')[0]!,
            dash = token.indexOf('-'),
            algorithm = token.slice(0, dash),
            hex = Buffer.from(token.slice(dash + 1), 'base64').toString('hex');
          const cache = join(
            text(environment.HOME),
            '.npm/_cacache/content-v2',
            algorithm,
            hex.slice(0, 2),
            hex.slice(2, 4),
            hex.slice(4),
          );
          try {
            npmBytes += (await stat(cache)).size;
          } catch {
            assert.equal(typeof entry.resolved, 'string');
            assert.ok(
              String(entry.resolved).startsWith('https://registry.npmjs.org/'),
            );
            const response = await fetch(String(entry.resolved), {
              method: 'HEAD',
              signal: AbortSignal.timeout(15000),
            });
            assert.equal(response.status, 200);
            const size = Number(response.headers.get('content-length'));
            assert.ok(Number.isSafeInteger(size) && size > 0);
            npmBytes += size;
            registryHeads++;
          }
        }
        const manifest = object(
          JSON.parse(
            docker([
              'buildx',
              'imagetools',
              'inspect',
              postgresDigest,
              '--raw',
            ]),
          ),
        );
        const postgresBytes = (manifest.layers as { size: number }[]).reduce(
          (total, layer) => total + layer.size,
          0,
        );
        facts.downloadEstimate = {
          postgresBytes,
          npmBytes,
          registryHeads,
          totalBatchUpperEstimate: assertDownloadBudget(
            postgresBytes,
            npmBytes,
          ),
          cacheReuse:
            'Host npm install offline; production-image npm ci uses ordinary public downloads bounded by the selected lock compressed tarballs.',
        };
      });
    if (!passed('cached-image-contracts'))
      await check('cached-image-contracts', async () => {
        const node = object(
          JSON.parse(
            docker([
              'image',
              'inspect',
              '--format',
              '{{json .Config}}',
              nodeDigest,
            ]),
          ),
        );
        assert.ok((node.Env as string[]).includes('NODE_VERSION=26.13.1'));
        const index = object(
          JSON.parse(
            docker([
              'buildx',
              'imagetools',
              'inspect',
              'node:26.13.1-bookworm-slim',
              '--raw',
            ]),
          ),
        );
        assert.ok(
          (
            index.manifests as {
              digest: string;
              platform: { architecture: string };
            }[]
          ).some(
            (item) =>
              item.digest === nodeDigest.split('@')[1] &&
              item.platform.architecture === 'amd64',
          ),
        );
        facts.nodeImage = {
          digest: nodeDigest,
          id: docker(['image', 'inspect', '--format', '{{.Id}}', nodeDigest]),
          version: '26.13.1',
          os: 'Debian12 bookworm',
        };
        validateOperationImageAlias(
          docker(
            [
              'image',
              'inspect',
              '--format',
              '{{.Id}}',
              'node:26.13.1-bookworm-slim',
            ],
            false,
          ),
          docker(['image', 'inspect', '--format', '{{.Id}}', nodeDigest]),
        );
        docker(['tag', nodeDigest, 'node:26.13.1-bookworm-slim']);
      });
    if (
      !docker(
        ['image', 'inspect', '--format', '{{.Id}}', postgresDigest],
        false,
      )
    )
      await run(
        'fetch-matching-bookworm',
        'sudo',
        ['-n', 'docker', 'pull', postgresDigest],
        repository,
        {},
        180000,
      );
    validateOperationImageAlias(
      docker(
        ['image', 'inspect', '--format', '{{.Id}}', 'postgres:16.16-bookworm'],
        false,
      ),
      docker(['image', 'inspect', '--format', '{{.Id}}', postgresDigest]),
    );
    docker(['tag', postgresDigest, 'postgres:16.16-bookworm']);
    facts.postgresImage = {
      digest: postgresDigest,
      id: docker(['image', 'inspect', '--format', '{{.Id}}', postgresDigest]),
      version: '16.16',
      os: 'Debian12 bookworm; cached16.16/trixie was not aliased',
    };
    const wrapper = join(workspace, 'bin');
    await mkdir(wrapper, { recursive: true });
    await writeFile(
      join(wrapper, 'docker'),
      '#!/bin/sh\nexec sudo -n --preserve-env=VCLI_POSTGRES_PASSWORD,VCLI_CGROUP_PARENT,VCLI_DATABASE_PORT,VCLI_WORKSPACE_ID,COMPOSE_DISABLE_ENV_FILE docker "$@"\n',
      { mode: 0o700 },
    );
    environment.PATH = wrapper + ':' + process.env.PATH;
    let secrets: Record<string, string>;
    try {
      secrets = JSON.parse(
        await readFile(join(workspace, 'private-state.json'), 'utf8'),
      ) as Record<string, string>;
    } catch {
      secrets = {
        database: randomBytes(24).toString('hex'),
        jwt: randomBytes(32).toString('base64url'),
        password: 'Fixture ' + randomBytes(20).toString('hex') + ' password!',
      };
      await writeFile(
        join(workspace, 'private-state.json'),
        JSON.stringify(secrets),
        { mode: 0o600 },
      );
    }
    privateValues.push(...Object.values(secrets));
    composeEnv.VCLI_POSTGRES_PASSWORD = secrets.database;
    composeEnv.VCLI_DATABASE_PORT = String(await availablePort());
    if (!passed('services-real-isolation-preservation'))
      await check('services-real-isolation-preservation', async () => {
        const previewBefore = await readFile(
          join(project, 'vcli.lock.json'),
          'utf8',
        );
        await cli('services-preview', [
          'services',
          'plan',
          '--environment',
          'test',
        ]);
        assert.equal(
          await readFile(join(project, 'vcli.lock.json'), 'utf8'),
          previewBefore,
        );
        let db = await databaseUp('development');
        docker([
          'exec',
          db,
          'psql',
          '-U',
          'app',
          '-d',
          'app',
          '-c',
          "CREATE TABLE IF NOT EXISTS operation_gate_probe(value text PRIMARY KEY); INSERT INTO operation_gate_probe VALUES ('kept') ON CONFLICT DO NOTHING",
        ]);
        await databaseDown('development');
        assert.ok(
          docker([
            'volume',
            'inspect',
            '--format',
            '{{.Name}}',
            name + '-development-database-data',
          ]),
        );
        db = await databaseUp('test');
        assert.equal(
          docker([
            'exec',
            db,
            'psql',
            '-U',
            'app',
            '-d',
            'app',
            '-Atc',
            "SELECT to_regclass('operation_gate_probe')",
          ]),
          '',
        );
        await databaseDown('test');
        db = await databaseUp('development');
        assert.equal(
          docker([
            'exec',
            db,
            'psql',
            '-U',
            'app',
            '-d',
            'app',
            '-Atc',
            'SELECT value FROM operation_gate_probe',
          ]),
          'kept',
        );
        await databaseDown('development');
        facts.localServices = {
          developmentVolume: name + '-development-database-data',
          testVolume: name + '-test-database-data',
          memoryBytes: 536870912,
          cgroupParent: 'orca.slice',
          pidsLimit: 128,
          ordinaryDownPreservesVolumes: true,
          hostBoundary:
            'Only each task-owned DB was attached to the existing Orca private network for host/API access.',
        };
      });
    if (!passed('production-image-build'))
      await run(
        'production-image-build',
        'sudo',
        [
          '-n',
          'env',
          'DOCKER_BUILDKIT=0',
          'docker',
          ...buildOperationArguments(project, image, text(facts.sourceCommit)),
        ],
        project,
        {},
        600000,
      );
    facts.imageId = docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    await check('production-image-audit', async () => {
      const config = object(
        JSON.parse(
          docker(['image', 'inspect', '--format', '{{json .Config}}', image]),
        ),
      );
      assert.equal(config.User, 'node');
      for (const value of [...privateValues, ...redisUrls])
        assert.equal(JSON.stringify(config).includes(value), false);
      const audit = docker([
        'run',
        '--rm',
        '--pull=never',
        '--network',
        'none',
        '--cgroup-parent',
        'orca.slice',
        '--memory',
        '64m',
        '--cpus',
        '0.25',
        '--pids-limit',
        '64',
        image,
        'node',
        '--input-type=module',
        '-e',
        "import{stat,lstat,access}from'node:fs/promises';const paths=['/app/var','/app/var/storage'];for(const p of paths){const s=await stat(p);if((s.mode&511)!==448||s.uid!==1000)throw Error('PRIVATE_ROOT');}for(const p of ['/app/src','/app/tools','/app/.env','/app/node_modules/@vcli/cli']){if(await access(p).then(()=>true,()=>false))throw Error('PRIVATE_BUILD_INPUT');}if((await lstat('/app/node_modules/@vcli/auth-runtime')).isSymbolicLink())throw Error('AUTH_LINK');console.log(JSON.stringify({uid:process.getuid(),roots0700:true,authCopied:true,devCliAbsent:true}));",
      ]);
      facts.imageAudit = JSON.parse(audit);
      assert.equal(object(facts.imageAudit).uid, 1000);
      const history = docker([
        'history',
        '--no-trunc',
        '--format',
        '{{.CreatedBy}}',
        image,
      ]);
      for (const value of [...privateValues, ...redisUrls])
        assert.equal(history.includes(value), false);
      facts.imageHistorySha256 = createHash('sha256')
        .update(history)
        .digest('hex');
    });
    const database = await databaseUp('development');
    const databaseIp = docker([
      'inspect',
      '--format',
      '{{(index .NetworkSettings.Networks "' + network + '").IPAddress}}',
      database,
    ]);
    const databaseUrl =
      'postgresql://app:' + secrets.database + '@' + databaseIp + ':5432/app';
    privateValues.push(databaseUrl);
    const runtime: Record<string, string> = {
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      PORT: '3100',
      PUBLIC_ORIGIN: 'https://operations.example.invalid',
      ALLOWED_ORIGINS: 'http://127.0.0.1:3100',
      DATABASE_URL: databaseUrl,
      REDIS_URL: containerRedisUrl,
      JWT_KEYS_JSON: JSON.stringify([{ id: 'ops1', key: secrets.jwt }]),
      JWT_ACTIVE_KID: 'ops1',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '9',
      MAIL_FROM: 'application@example.invalid',
      LOCAL_STORAGE_ROOT: '/app/var/storage',
      OPERATION_FIXTURE_PASSWORD: secrets.password!,
    };
    const configDirectory = await mkdtemp(join(workspace, 'runtime-config-'));
    privateConfigDirectory = configDirectory;
    const runtimeFile = join(configDirectory, 'runtime.env');
    await writeFile(
      runtimeFile,
      Object.entries(runtime)
        .map(([key, value]) => key + '=' + value)
        .join('\n') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    const baseRun = [
      'run',
      '--rm',
      '--pull=never',
      '--network',
      network,
      '--cgroup-parent',
      'orca.slice',
      '--memory',
      '512m',
      '--cpus',
      '1',
      '--pids-limit',
      '256',
      '--env-file',
      runtimeFile,
    ];
    redisCleanupNeeded = true;
    await clearGeneratedRedisRates(hostRedisUrl, name, 'production');
    await clearGeneratedRedisRates(hostRedisUrl, name, 'development');
    const probeKey =
      generatedRedisRatePrefix(name, 'production') +
      'operations-probe:' +
      randomBytes(16).toString('hex');
    const probeValue = randomBytes(16).toString('hex');
    await withGeneratedRedisClient(hostRedisUrl, async (client) => {
      assert.equal(
        await client.set(probeKey, probeValue, { NX: true, PX: 60_000 }),
        'OK',
      );
    });
    const probe = `import { createClient } from '@redis/client';
const client = createClient({ url: process.env.REDIS_URL, RESP: 2, disableClientInfo: true, disableOfflineQueue: true, socket: { connectTimeout: 5000, reconnectStrategy: false } });
client.on('error', () => {});
const timer = setTimeout(() => { if (client.isOpen) client.destroy(); }, 5000);
try {
  await client.connect();
  const value = await client.get(${JSON.stringify(probeKey)});
  if (value !== ${JSON.stringify(probeValue)}) throw new Error('Redis fixture mismatch');
  process.stdout.write('SHARED_REDIS_FIXTURE');
} catch {
  process.stderr.write('Container REDIS_URL did not reach the host fixture database');
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  if (client.isOpen) client.destroy();
}`;
    try {
      assert.equal(
        await run(
          'image-redis-shared-fixture',
          'sudo',
          [
            '-n',
            'docker',
            ...baseRun,
            '-i',
            image,
            'node',
            '--input-type=module',
          ],
          project,
          {},
          20_000,
          0,
          probe,
        ),
        'SHARED_REDIS_FIXTURE',
      );
    } finally {
      await withGeneratedRedisClient(hostRedisUrl, async (client) => {
        await client.del(probeKey);
      });
    }
    await run(
      'image-explicit-release',
      'sudo',
      [
        '-n',
        'docker',
        ...baseRun,
        image,
        'node',
        'dist/initialize-database.js',
      ],
      project,
    );
    const seed = `import {ArgonPasswords} from './dist/modules/identity/argon-passwords.service.js';import pg from 'pg';import {randomUUID} from 'node:crypto';const p=await ArgonPasswords.create();const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});const email='operations@example.invalid',hash=await p.hash(process.env.OPERATION_FIXTURE_PASSWORD);try{const old=await pool.query('SELECT id FROM accounts WHERE email=$1',[email]);if(!old.rowCount){const id=randomUUID();await pool.query('INSERT INTO accounts(id,email,email_verified,enabled,created_at) VALUES($1,$2,true,true,$3)',[id,email,Date.now()]);await pool.query('INSERT INTO identities(key,account_id,password_hash,credential_version,enrollment_cutoff,generation,active,methods,cleanup_pending) VALUES($1,$2,$3,1,0,1,true,$4,false)',['local:'+email,id,hash,JSON.stringify(['password'])]);}console.log('REAL_ARGON_SEED_COMPLETE');}finally{await pool.end();}`;
    await run(
      'image-native-argon-seed',
      'sudo',
      ['-n', 'docker', ...baseRun, '-i', image, 'node', '--input-type=module'],
      project,
      {},
      30000,
      0,
      seed,
    );
    const storage = name + '-image-storage';
    docker([
      'volume',
      'create',
      '--label',
      'io.vcli.operations=' + suffix,
      storage,
    ]);
    volumes.add(storage);
    const apiName = name + '-image-api';
    const api = docker([
      'run',
      '-d',
      '--pull=never',
      '--name',
      apiName,
      '--label',
      'io.vcli.operations=' + suffix,
      '--network',
      network,
      '--cgroup-parent',
      'orca.slice',
      '--memory',
      '512m',
      '--cpus',
      '1',
      '--pids-limit',
      '256',
      '--env-file',
      runtimeFile,
      '--mount',
      'type=volume,src=' + storage + ',dst=/app/var/storage',
      image,
    ]);
    containers.add(api);
    rateApiContainer = api;
    const ip = docker([
        'inspect',
        '--format',
        '{{(index .NetworkSettings.Networks "' + network + '").IPAddress}}',
        api,
      ]),
      origin = 'http://' + ip + ':3100';
    async function request(
      path: string,
      method = 'GET',
      body?: unknown,
      token?: string,
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const response = await fetch(origin + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      return { status: response.status, body: object(await response.json()) };
    }
    await check('image-health-jose-native-notes-restart', async () => {
      const ready = await waitFor(async () => {
        try {
          const r = await request('/health/ready');
          return r.status === 200 ? r : undefined;
        } catch {
          return undefined;
        }
      }, 'IMAGE_READINESS');
      assert.equal(ready.body.buildId, facts.sourceCommit);
      const release = JSON.parse(
        docker([
          'exec',
          api,
          'node',
          '--input-type=module',
          '-e',
          "import{selectedReleaseManifest}from'./dist/generated/selected-release.js';console.log(JSON.stringify({id:selectedReleaseManifest.id}));",
        ]),
      );
      assert.equal(ready.body.schemaReleaseId, object(release).id);
      facts.readiness = {
        buildId: ready.body.buildId,
        schemaReleaseId: ready.body.schemaReleaseId,
        sourceIdentity:
          'controlled40hex fixture; no published OCI/deployed proof',
      };
      const login = await request('/api/identity/local/login', 'POST', {
        email: 'operations@example.invalid',
        password: secrets.password,
        installationCapability: randomBytes(32).toString('base64url'),
        platform: 'web',
      });
      assert.equal(login.status, 200);
      const token = text(login.body.accessToken);
      privateValues.push(token, text(login.body.refreshToken));
      assert.equal(token.split('.').length, 3);
      assert.equal(
        (await request('/api/accounts/me', 'GET', undefined, token)).status,
        200,
      );
      const note = await request(
        '/api/notes',
        'POST',
        { title: 'Production image fixture', body: 'Persisted image note' },
        token,
      );
      assert.equal(note.status, 201);
      const noteId = text(object(note.body.note).id);
      assert.equal((await request('/api/notes/' + noteId)).status, 401);
      docker(['stop', '--time', '10', api]);
      const state = object(
        JSON.parse(docker(['inspect', '--format', '{{json .State}}', api])),
      );
      assert.equal(state.Running, false);
      assert.equal(state.ExitCode, 0);
      docker(['start', api]);
      await waitFor(async () => {
        try {
          return (await request('/health/ready')).status === 200
            ? true
            : undefined;
        } catch {
          return undefined;
        }
      }, 'IMAGE_RESTART');
      assert.equal(
        (await request('/api/notes/' + noteId, 'GET', undefined, token)).status,
        200,
      );
      facts.imageRestart = {
        exitCode: state.ExitCode,
        nativeRowsPreserved: true,
        volumeIdentity: storage,
      };
    });
    docker(['stop', '--time', '10', api]);
    docker(['rm', api]);
    containers.delete(api);
    rateApiContainer = undefined;
    await check('actual-dev-owned-shutdown-and-json-refusal', async () => {
      const port = await availablePort();
      sentinel = createServer((_request, response) => {
        response.end('sentinel-alive');
      });
      await new Promise<void>((done) => sentinel!.listen(0, '127.0.0.1', done));
      const address = sentinel.address();
      assert.ok(address && typeof address !== 'string');
      const sentinelOrigin = 'http://127.0.0.1:' + address.port;
      const devFile = join(configDirectory, 'development.env');
      const devEnv = {
        ...runtime,
        NODE_ENV: 'development',
        REDIS_URL: hostRedisUrl,
        LOCAL_STORAGE_ROOT: join(workspace, 'dev-storage'),
      };
      await writeFile(
        devFile,
        Object.entries(devEnv)
          .map(([key, value]) => key + '=' + value)
          .join('\n') + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      await cli(
        'dev-json-refusal',
        ['dev', '--port', String(port), '--config-file', devFile],
        {},
        1,
      );
      await cli('dev-dry-run', [
        'dev',
        '--port',
        String(port),
        '--config-file',
        devFile,
        '--dry-run',
      ]);
      let output = '';
      dev = spawn(
        process.execPath,
        [localCli, 'dev', '--port', String(port), '--config-file', devFile],
        {
          cwd: project,
          env: environment,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      for (const stream of [dev.stdout, dev.stderr])
        stream?.on('data', (data) => {
          if (output.length < 2000000) output += String(data);
        });
      const closed = new Promise<number | null>((done) =>
        dev!.once('close', (code) => done(code)),
      );
      devClosed = closed;
      await waitFor(
        async () => {
          try {
            const r = await fetch(
              'http://127.0.0.1:' + port + '/health/ready',
              { signal: AbortSignal.timeout(1000) },
            );
            return r.status === 200 ? true : undefined;
          } catch {
            return undefined;
          }
        },
        'DEV_READINESS',
        90000,
      );
      const login = await fetch(
        'http://127.0.0.1:' + port + '/api/identity/local/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'operations@example.invalid',
            password: secrets.password,
            installationCapability: randomBytes(32).toString('base64url'),
            platform: 'web',
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      await login.body?.cancel();
      assert.equal(login.status, 200, 'DEV_REDIS_AUTH_LOGIN');
      dev.kill('SIGTERM');
      const code = await Promise.race([
        closed,
        delay(15_000, undefined, { ref: false }).then(() => {
          throw new Error('DEV_SHUTDOWN_TIMEOUT');
        }),
      ]);
      await writeFile(join(evidence, 'actual-dev.log'), safeOutput(output), {
        mode: 0o600,
      });
      assert.ok(code === 0 || code === 143, 'DEV_EXIT');
      await waitFor(async () => {
        try {
          await fetch('http://127.0.0.1:' + port + '/health/live', {
            signal: AbortSignal.timeout(500),
          });
          return undefined;
        } catch {
          return true;
        }
      }, 'DEV_LISTENER_RELEASE');
      assert.equal(
        await (await fetch(sentinelOrigin)).text(),
        'sentinel-alive',
      );
      dev = undefined;
      facts.dev = {
        ready: true,
        redisAuthLogin: true,
        exitCode: code,
        sentinelSurvived: true,
        portReleased: true,
      };
    });
    await databaseDown('development');
    success = true;
  } catch (error) {
    await writeFile(
      join(evidence, 'failure.log'),
      safeOutput(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
      { mode: 0o600 },
    );
    await save();
    throw new Error(
      'GENERATED_OPERATIONS_FAILED: inspect private sanitized evidence and retained task workspace',
      {
        // eslint-disable-next-line preserve-caught-error -- Provider errors can echo runtime credentials; evidence and cause retain only sanitized text.
        cause: new Error(
          safeOutput(error instanceof Error ? error.message : String(error)),
        ),
      },
    );
  } finally {
    let devStopped = !dev;
    if (dev?.pid) {
      try {
        dev.kill('SIGTERM');
      } catch {
        // The task-owned CLI may already have stopped.
      }
      if (devClosed)
        devStopped = await Promise.race([
          devClosed.then(() => true),
          delay(15_000, false, { ref: false }),
        ]);
    }
    if (sentinel)
      await new Promise<void>((done) => sentinel!.close(() => done()));
    for (const id of containers) {
      const labels = docker(
        ['inspect', '--format', '{{json .Config.Labels}}', id],
        false,
      );
      if (labels && (labels.includes(suffix) || labels.includes(name))) {
        docker(['stop', '--time', '5', id], false);
        const removed = docker(['rm', id], false);
        if (id === rateApiContainer && removed) rateApiContainer = undefined;
      }
    }
    if (privateConfigDirectory)
      await rm(privateConfigDirectory, { recursive: true, force: true });
    if (redisCleanupNeeded) {
      const started = Date.now();
      const cleanup =
        devStopped && !rateApiContainer
          ? await Promise.allSettled([
              clearGeneratedRedisRates(hostRedisUrl, name, 'production'),
              clearGeneratedRedisRates(hostRedisUrl, name, 'development'),
            ])
          : [];
      const cleaned =
        cleanup.length === 2 &&
        cleanup.every((result) => result.status === 'fulfilled');
      records.push({
        name: 'redis-rate-fixture-cleanup',
        exitCode: cleaned ? 0 : 1,
        elapsedMs: Date.now() - started,
      });
      if (!cleaned) {
        redisCleanupFailed = true;
        success = false;
        await writeFile(
          join(evidence, 'redis-rate-fixture-cleanup.log'),
          cleanup.length
            ? 'Could not clear the generated project rate namespaces.'
            : 'An owned API process could not be confirmed stopped.',
          { mode: 0o600 },
        );
      }
      await save();
    }
    if (success) {
      for (const volume of volumes) {
        const labels = docker(
          ['volume', 'inspect', '--format', '{{json .Labels}}', volume],
          false,
        );
        if (labels && (labels.includes(name) || labels.includes(suffix)))
          docker(['volume', 'rm', volume], false);
      }
      const labels = docker(
        ['image', 'inspect', '--format', '{{json .Config.Labels}}', image],
        false,
      );
      if (labels?.includes(image)) docker(['image', 'rm', image], false);
      await rm(workspace, { recursive: true });
    }
  }
  if (redisCleanupFailed)
    throw new Error('GENERATED_OPERATIONS_REDIS_CLEANUP_FAILED');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await verifyGeneratedOperations();

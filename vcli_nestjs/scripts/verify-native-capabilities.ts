import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { linkGeneratedDependencies } from '../test/generated-dependencies.ts';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import {
  redactGeneratedRedisOutput,
  requireGeneratedRedisTestUrl,
} from './generated-redis-fixture.ts';

// Coordinator-only local acceptance. Uses cached, capped containers; never provider accounts.
const root = resolve('.');
const evidenceRoot = join(root, 'var/cli-evidence/native-capabilities');
const evidence = join(evidenceRoot, 'attempt-' + Date.now());
const identityRedis =
  process.env.VCLI_IDENTITY_REDIS_TEST_URL === undefined
    ? undefined
    : requireGeneratedRedisTestUrl(process.env, 'VCLI_IDENTITY_REDIS_TEST_URL');
await mkdir(evidence, { recursive: true, mode: 0o700 });
const environment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  NO_COLOR: '1',
};
const records: { name: string; exitCode: number | null; elapsedMs: number }[] =
  [];
const privateValues: string[] = [];
let ownedContainer: string | undefined;
function docker(args: string[], required = true): string {
  const result = spawnSync('sudo', ['-n', 'docker', ...args], {
    env: environment,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1000000,
  });
  if (required) {
    assert.ifError(result.error);
    assert.equal(result.status, 0, 'TASK_CONTAINER_OPERATION_FAILED');
  }
  return result.status === 0 ? result.stdout : '';
}
async function run(
  name: string,
  args: string[],
  extra: NodeJS.ProcessEnv = {},
) {
  const start = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...environment, ...extra },
    encoding: 'utf8',
    timeout: 240000,
    maxBuffer: 16000000,
  });
  let output = result.stdout + result.stderr;
  if (identityRedis)
    output = redactGeneratedRedisOutput(output, [identityRedis]);
  for (const value of privateValues)
    output = output.replaceAll(value, '[PRIVATE]');
  await writeFile(join(evidence, name + '.log'), output, { mode: 0o600 });
  records.push({
    name,
    exitCode: result.status,
    elapsedMs: Date.now() - start,
  });
  console.log(name + ': ' + (result.status === 0 ? 'passed' : 'FAILED'));
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'See private sanitized ' + name + '.log');
}
async function compilePreparation(driver: 'mongodb' | 'postgres') {
  const directory = join(evidence, 'preparation', driver);
  await mkdir(join(directory, 'src/modules'), { recursive: true });
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  await linkGeneratedDependencies(directory);
  await cp('templates/runtime/common/src/core', join(directory, 'src/core'), {
    recursive: true,
  });
  await cp(
    `templates/runtime/${driver}/src/core/database`,
    join(directory, 'src/core/database'),
    { recursive: true },
  );
  await cp(
    'templates/runtime/common/src/modules/storage',
    join(directory, 'src/modules/storage'),
    { recursive: true },
  );
  for (const owner of [
    'identity',
    'accounts',
    'installations',
    'sessions',
    'media',
    'push',
    'notes',
  ]) {
    await cp(
      `templates/runtime/common/src/modules/${owner}`,
      join(directory, 'src/modules', owner),
      { recursive: true },
    );
    await cp(
      `templates/runtime/${driver}/src/modules/${owner}`,
      join(directory, 'src/modules', owner),
      { recursive: true },
    );
  }
  await mkdir(join(directory, 'src/core/config'), { recursive: true });
  await writeFile(
    join(directory, 'src/core/config/app-config.ts'),
    'export type AppConfig={database:{url:string}};\n',
  );
  await cp(
    `templates/runtime/${driver}/src/initialize-identity-database.ts`,
    join(directory, 'src/initialize-identity-database.ts'),
  );
  if (driver === 'postgres')
    await cp(
      'templates/runtime/postgres/migrations',
      join(directory, 'migrations'),
      { recursive: true },
    );
  const prefix = driver === 'postgres' ? 'postgres' : 'mongo';
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    noUncheckedIndexedAccess: true,
    rootDir: join(directory, 'src'),
    outDir: join(directory, 'out'),
    types: ['node'],
  };
  const program = ts.createProgram(
    [
      join(directory, 'src/initialize-identity-database.ts'),
      join(directory, `src/modules/media/${prefix}-media-state-store.ts`),
      join(directory, `src/modules/push/${prefix}-push-state-store.ts`),
      join(directory, 'src/modules/notes/initialize-notes.ts'),
    ],
    options,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
  program.emit();
  await writeFile(
    join(directory, 'prepare.mjs'),
    `
import {initializeIdentityDatabase} from './out/initialize-identity-database.js';
import {${driver === 'postgres' ? 'Postgres' : 'Mongo'}MediaStateStore as Media} from './out/modules/media/${prefix}-media-state-store.js';
import {${driver === 'postgres' ? 'Postgres' : 'Mongo'}PushStateStore as Push} from './out/modules/push/${prefix}-push-state-store.js';
import {${driver === 'postgres' ? 'Postgres' : 'Mongo'}Database as Database} from './out/core/database/${prefix}-database.js';
import {initializeNotes} from './out/modules/notes/initialize-notes.js';
for(const url of [process.env.AUTH_URL,process.env.REALTIME_URL]) await initializeIdentityDatabase({database:{url}});
await (await Media.connect(process.env.MEDIA_URL,true)).close();
await (await Push.connect(process.env.PUSH_URL,true)).close();
const notes=await Database.connect(process.env.NOTES_URL,false);try{await initializeNotes(notes);}finally{await notes.close();}
`,
  );
  return join(directory, 'prepare.mjs');
}
try {
  for (const driver of ['postgres', 'mongodb'] as const) {
    if (
      process.env.VCLI_NATIVE_DATABASE &&
      process.env.VCLI_NATIVE_DATABASE !== driver
    )
      continue;
    const suffix = randomBytes(5).toString('hex');
    const container = 'vcli-native-' + driver + '-' + suffix;
    const password = randomBytes(24).toString('hex');
    privateValues.push(password);
    const args = [
      'run',
      '-d',
      '--pull',
      'never',
      '--name',
      container,
      '--label',
      'vcli.native.task=' + suffix,
      '--network',
      'my-first-project-orcaserver-bwwu6y_default',
      '--cgroup-parent',
      'orca.slice',
      '--memory',
      driver === 'postgres' ? '192m' : '512m',
      '--cpus',
      driver === 'postgres' ? '0.5' : '0.75',
      '--pids-limit',
      '256',
    ];
    if (driver === 'postgres')
      args.push(
        '-e',
        'POSTGRES_USER=fixture',
        '-e',
        'POSTGRES_PASSWORD=' + password,
        '-e',
        'POSTGRES_DB=fixture',
      );
    args.push(
      driver === 'postgres'
        ? 'postgres@sha256:63e83b5a3dc36a917dccb76fe1bd2ac51f1ec9c1deb47ff20d4f04233bf6eae9'
        : 'mongo@sha256:9b73c38e39783bd21335f603a9f08be60fe385f5c28933ea32bb4a9fa1fd6d23',
    );
    if (driver === 'mongodb')
      args.push(
        'mongod',
        '--replSet',
        'rs0',
        '--bind_ip_all',
        '--wiredTigerCacheSizeGB',
        '0.25',
      );
    docker(args);
    ownedContainer = container;
    async function ready(command: string[]) {
      for (let i = 0; i < 60; i++) {
        if (docker(['exec', container, ...command], false)) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw new Error('TASK_DATABASE_READINESS_TIMEOUT');
    }
    await ready(
      driver === 'postgres'
        ? ['pg_isready', '-h', '127.0.0.1', '-U', 'fixture', '-d', 'fixture']
        : ['mongosh', '--quiet', '--eval', 'db.adminCommand({ping:1})'],
    );
    if (driver === 'mongodb') {
      docker([
        'exec',
        container,
        'mongosh',
        '--quiet',
        '--eval',
        'rs.initiate({_id:"rs0",members:[{_id:0,host:"' +
          container +
          ':27017"}]})',
      ]);
      await ready([
        'mongosh',
        '--quiet',
        '--eval',
        'if(!db.hello().isWritablePrimary)quit(1);print("ready")',
      ]);
    }
    const url = (name: string) =>
      driver === 'postgres'
        ? `postgres://fixture:${password}@${container}:5432/${name}`
        : `mongodb://${container}:27017/${name}?replicaSet=rs0`;
    const names = [
      'auth',
      'mail',
      'media',
      'push',
      'notes',
      'realtime',
      'release',
    ].map((name) => 'vcli_' + name);
    const restoreName = 'vcli_restore_' + suffix;
    if (driver === 'postgres')
      for (const name of [...names, restoreName])
        docker(['exec', container, 'createdb', '-U', 'fixture', name]);
    for (const name of [...names, restoreName]) privateValues.push(url(name));
    const preparation = await compilePreparation(driver);
    await run(driver + '-prepare', [preparation], {
      AUTH_URL: url('vcli_auth'),
      REALTIME_URL: url('vcli_realtime'),
      MEDIA_URL: url('vcli_media'),
      PUSH_URL: url('vcli_push'),
      NOTES_URL: url('vcli_notes'),
    });
    const suites = [
      [
        'identity',
        'test/auth-lifecycle-native.test.ts',
        { VCLI_IDENTITY_TEST_DATABASE: driver },
        'vcli_auth',
      ],
      [
        'mail',
        'test/mail-lifecycle-runtime.test.ts',
        { VCLI_MAIL_DATABASE: driver },
        'vcli_mail',
      ],
      [
        'media',
        'test/storage-lifecycle-runtime.test.ts',
        { VCLI_MEDIA_TEST_DATABASE: driver },
        'vcli_media',
      ],
      [
        'push',
        'test/push-lifecycle-native.test.ts',
        { VCLI_PUSH_TEST_DATABASE: driver },
        'vcli_push',
      ],
      [
        'realtime',
        'test/realtime-scale-native.test.ts',
        { TEST_DATABASE_KIND: driver },
        'vcli_realtime',
      ],
      [
        'notes',
        'test/notes-example-native.test.ts',
        { VCLI_NOTES_TEST_DATABASE: driver },
        'vcli_notes',
      ],
      [
        'release',
        'test/release-native.test.ts',
        { VCLI_RELEASE_TEST_DATABASE: driver },
        'vcli_release',
      ],
    ] as const;
    const wrapper = join(evidence, 'native-tool-' + driver + '.mjs');
    const wrapperSource = await readFile(
      join(root, 'scripts/native-container-tools.mjs'),
      'utf8',
    );
    await writeFile(
      wrapper,
      wrapperSource.replace('__TASK_CONTAINER__', container),
      { mode: 0o700 },
    );
    for (const [name, path, extra, database] of suites) {
      if (
        process.env.VCLI_NATIVE_CAPABILITY &&
        !process.env.VCLI_NATIVE_CAPABILITY.split(',').includes(name)
      )
        continue;
      await run(
        driver + '-' + name,
        [
          '--test',
          '--test-concurrency=1',
          '--test-name-pattern',
          'native',
          path,
        ],
        {
          TEST_DATABASE_URL: url(database),
          ...extra,
          ...(name === 'identity' && identityRedis
            ? { VCLI_IDENTITY_REDIS_TEST_URL: identityRedis }
            : {}),
          ...(name === 'release'
            ? {
                TEST_RESTORE_DATABASE_URL: url(restoreName),
                VCLI_RELEASE_NATIVE_TOOLS: '1',
                VCLI_RELEASE_TOOL_WRAPPER: wrapper,
              }
            : {}),
        },
      );
    }
    docker(['stop', '--time', '5', container]);
    docker(['rm', '--volumes', container]);
    ownedContainer = undefined;
  }
} finally {
  if (ownedContainer) {
    docker(['stop', '--time', '5', ownedContainer], false);
    docker(['rm', '--volumes', ownedContainer], false);
  }
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(
      {
        records,
        scope: 'local real native persistence; controlled provider boundaries',
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await writeFile(
    join(evidenceRoot, 'latest.json'),
    JSON.stringify(
      { attempt: evidence.slice(root.length + 1), records },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

import assert from 'node:assert/strict';
import { Command } from 'commander';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import test from 'node:test';
import type { ProjectConfig, RecipeCatalog } from '../src/contracts.ts';
import type { CommandResult } from '../src/commands/command-output.ts';
import type { ServiceInvocation } from '../src/services/service-types.ts';
import {
  registerOperationalCommands,
  type OperationalExecution,
} from '../dist/commands/operational-commands.js';
import { publicError } from '../dist/commands/command-output.js';
import { planInit, applyPlan } from '../dist/engine/index.js';
import { configuration } from '../dist/recipes/render-config.js';
import { serviceFiles } from '../dist/recipes/render-services.js';
import {
  serviceResourceName,
  describeServices,
} from '../dist/recipes/service-plan.js';
import { runOwnedProcess } from '../dist/services/owned-process.js';

const scripts = {
  'start:dev': 'nest start --watch',
  'release:apply': 'node dist/initialize-database.js',
  'release:reconcile': 'node dist/release/reconcile-command.js',
  'backup:create': 'node dist/release/backup-command.js',
  'backup:restore': 'node dist/release/restore-command.js',
};
const base = path.resolve('var/cli-operation-command-integration');
async function fixture(
  t: test.TestContext,
  options: { name?: string; database?: boolean; installed?: boolean } = {},
): Promise<string> {
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, 'command-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, 'app');
  const config: ProjectConfig = {
    schemaVersion: 1,
    project: { name: options.name ?? 'operations-api', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      ...(options.database === false
        ? {}
        : { database: { recipe: 'database.postgres', options: {} } }),
    },
  };
  const catalog: RecipeCatalog = {
    recipes: Object.entries(config.capabilities).map(([family, selected]) => ({
      id: selected.recipe,
      family,
      version: '0.1.1',
      requires: family === 'foundation' ? [] : ['foundation'],
      conflicts: [],
      validateOptions: () => ({}),
    })),
    render: async (selected) => ({
      files: [
        {
          path: 'package.json',
          ownership: 'managed',
          content: JSON.stringify({
            name: selected.project.name,
            version: '0.1.0',
            private: true,
            scripts:
              options.database === false
                ? { 'start:dev': scripts['start:dev'] }
                : scripts,
            dependencies: {},
            devDependencies: { '@nestjs/cli': '12.0.13' },
          }),
        },
        {
          path: 'src/managed-state.ts',
          ownership: 'managed',
          content: 'export const managed=true;\n',
        },
        ...serviceFiles(selected, configuration(selected).fields),
      ],
      checks: [],
      warnings: [],
      pending: [],
    }),
  };
  await applyPlan(
    await planInit({
      workspaceDir: workspace,
      projectDir: root,
      config,
      catalog,
    }),
  );
  if (options.installed) {
    const packageJson = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    await mkdir(path.join(root, 'node_modules/@nestjs/cli/bin'), {
      recursive: true,
    });
    await writeFile(
      path.join(root, 'node_modules/@nestjs/cli/package.json'),
      JSON.stringify({ name: '@nestjs/cli', version: '12.0.13' }),
    );
    await writeFile(
      path.join(root, 'node_modules/@nestjs/cli/bin/nest.js'),
      '// fixture only; never executed\n',
    );
    await writeFile(
      path.join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': {
            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies,
          },
          'node_modules/@nestjs/cli': { version: '12.0.13' },
        },
      }),
    );
    await writeFile(
      path.join(root, 'node_modules/.package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { 'node_modules/@nestjs/cli': { version: '12.0.13' } },
      }),
    );
    const lock = JSON.parse(
      await readFile(path.join(root, 'vcli.lock.json'), 'utf8'),
    ) as { outcomes: { install: string } };
    lock.outcomes.install = 'completed';
    await writeFile(path.join(root, 'vcli.lock.json'), JSON.stringify(lock));
    for (const target of [
      'dist/initialize-database.js',
      'dist/release/reconcile-command.js',
      'dist/release/backup-command.js',
      'dist/release/restore-command.js',
    ]) {
      await mkdir(path.dirname(path.join(root, target)), { recursive: true });
      await writeFile(
        path.join(root, target),
        '// fixture only; never executed\n',
      );
    }
  }
  return root;
}
async function digest(root: string): Promise<string> {
  const files: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(target);
      else
        files.push(
          path.relative(root, target) +
            ':' +
            createHash('sha256')
              .update(await readFile(target))
              .digest('hex'),
        );
    }
  };
  await visit(root);
  return createHash('sha256').update(files.sort().join('\n')).digest('hex');
}
async function invoke(
  root: string,
  args: string[],
  execution: OperationalExecution = {},
  json = true,
): Promise<{ result: CommandResult; code: number; operation: string }> {
  const program = new Command().exitOverride().configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
    outputError: () => undefined,
  });
  let operation = 'cli';
  const results: CommandResult[] = [];
  const oldExit = process.exitCode;
  process.exitCode = undefined;
  registerOperationalCommands(
    program,
    {
      project: () => root,
      json: () => json,
      setOperation: (value) => {
        operation = value;
      },
      emit: (result) => {
        results.push(result);
        if (result.status === 'failed') process.exitCode = 1;
      },
    },
    execution,
  );
  try {
    try {
      await program.parseAsync(['node', 'fixture', ...args]);
    } catch (error) {
      results.push({
        schemaVersion: 1,
        status: 'failed',
        operation,
        errors: [publicError(error)],
      });
      process.exitCode = 1;
    }
    assert.equal(results.length, 1);
    const result = results[0]!;
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
    return { result, code: Number(process.exitCode ?? 0), operation };
  } finally {
    process.exitCode = oldExit;
  }
}
const noExecution: OperationalExecution = {
  environment: () => ({
    DATABASE_URL: 'PRIVATE_SENTINEL',
    APP_ENV_FILE: '/PRIVATE_SENTINEL/file',
  }),
  serviceRunner: async () => {
    throw new Error('MUST_NOT_EXECUTE');
  },
  devRunner: async () => {
    throw new Error('MUST_NOT_EXECUTE');
  },
  releaseRunner: async () => {
    throw new Error('MUST_NOT_EXECUTE');
  },
};
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('registered services/dev/release previews are portable and zero-write on source-only state', async (t) => {
  const root = await fixture(t),
    before = await digest(root);
  for (const args of [
    ['services', 'plan'],
    ['services', 'up', '--environment', 'test', '--dry-run'],
    ['services', 'down', '--dry-run'],
    ['services', 'status', '--dry-run'],
    [
      'dev',
      '--environment',
      'test',
      '--port',
      '33001',
      '--config-file',
      'PRIVATE_SENTINEL.missing',
      '--dry-run',
    ],
    ['release', 'apply', '--dry-run'],
    ['release', 'backup', '--profile', 'PRIVATE_SENTINEL.missing', '--dry-run'],
    [
      'release',
      'reconcile',
      '--decision',
      'PRIVATE_SENTINEL.missing',
      '--dry-run',
    ],
  ]) {
    const outcome = await invoke(root, args, {
      ...noExecution,
      environment: () => {
        throw new Error('PRIVATE_ENV_READ_FORBIDDEN');
      },
    });
    assert.equal(outcome.code, 0);
    assert.equal(outcome.result.status, 'preview');
  }
  assert.equal(await digest(root), before);
  const outcome = await invoke(root, ['services', 'plan'], noExecution);
  const serialized = JSON.stringify(outcome.result);
  assert.match(serialized, /<project>/);
  assert.doesNotMatch(serialized, /\/usr\/|\/home\/|process\.execPath/);
});

test('registration refuses invalid environment/ports, missing project and unsupported local state without execution', async (t) => {
  const root = await fixture(t);
  assert.equal(
    (
      await invoke(
        root,
        ['services', 'up', '--environment', 'production', '--dry-run'],
        noExecution,
      )
    ).result.errors?.[0]?.code,
    'INVALID_LOCAL_ENVIRONMENT',
  );
  assert.equal(
    (await invoke(root, ['dev', '--port', '65536', '--dry-run'], noExecution))
      .result.errors?.[0]?.code,
    'INVALID_LOCAL_PORT',
  );
  assert.equal(
    (
      await invoke(
        root,
        ['services', 'plan', '--cgroup-parent', '../PRIVATE_SENTINEL'],
        noExecution,
      )
    ).result.errors?.[0]?.code,
    'INVALID_CGROUP_PARENT',
  );
  assert.equal(
    (
      await invoke(
        path.join(root, 'missing'),
        ['services', 'plan'],
        noExecution,
      )
    ).code,
    1,
  );
  await writeFile(
    path.join(root, 'src/managed-state.ts'),
    'USER_CUSTOMIZATION',
  );
  assert.equal(
    (await invoke(root, ['services', 'plan'], noExecution)).result.errors?.[0]
      ?.code,
    'OPERATIONAL_STATE_CONFLICT',
  );
  assert.equal(
    await readFile(path.join(root, 'src/managed-state.ts'), 'utf8'),
    'USER_CUSTOMIZATION',
  );
});

test('desired/realized drift refuses before runtime; missing local profile never falls back to development', async (t) => {
  const root = await fixture(t),
    lockPath = path.join(root, 'vcli.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
    files: Record<string, unknown>;
  };
  delete lock.files['ops/local/test/compose.yaml'];
  await writeFile(lockPath, JSON.stringify(lock));
  assert.equal(
    (
      await invoke(
        root,
        ['services', 'up', '--environment', 'test', '--dry-run'],
        noExecution,
      )
    ).result.errors?.[0]?.code,
    'LOCAL_PROFILE_NOT_GENERATED',
  );
  const configPath = path.join(root, 'vcli.json');
  const config = JSON.parse(
    await readFile(configPath, 'utf8'),
  ) as ProjectConfig;
  config.project.name = 'different-project';
  await writeFile(configPath, JSON.stringify(config));
  assert.equal(
    (await invoke(root, ['services', 'plan'], noExecution)).result.errors?.[0]
      ?.code,
    'STATE_DRIFT',
  );
});

test('source-only service up uses the test artifact and test durable identity without requiring app installation', async (t) => {
  const root = await fixture(t),
    calls: ServiceInvocation[] = [];
  const outcome = await invoke(
    root,
    [
      'services',
      'up',
      '--environment',
      'test',
      '--database-port',
      '33002',
      '--cgroup-parent',
      'fixture.slice',
    ],
    {
      environment: () => ({ PRIVATE_SENTINEL: 'PRIVATE_SENTINEL' }),
      serviceRunner: async (invocation) => {
        calls.push(invocation);
        return { code: 0, stdout: '' };
      },
    },
  );
  assert.equal(outcome.code, 0);
  assert.equal(calls.length, 3);
  assert.ok(calls[0]!.args.includes('ops/local/test/compose.yaml'));
  assert.ok(calls[0]!.args.includes('operations-api-test'));
  assert.match(calls[1]!.args.join(' '), /operations-api-test-database-data/);
  assert.equal(calls[0]!.environment.VCLI_DATABASE_PORT, '33002');
  assert.equal(calls[0]!.environment.VCLI_CGROUP_PARENT, 'fixture.slice');
  const data = outcome.result.data as {
    outcomes: { install: string; checks: string };
  };
  assert.equal(data.outcomes.install, 'pending');
  assert.equal(data.outcomes.checks, 'pending');
});

test('development/test profiles have independent immutable metadata, volumes and native names through64 characters', async (t) => {
  const name = 'a'.repeat(64),
    root = await fixture(t, { name });
  const get = async (environment: string) =>
    JSON.parse(
      await readFile(
        path.join(root, `ops/local/${environment}/service-plan.json`),
        'utf8',
      ),
    ) as {
      project: string;
      environment: string;
      volumes: { resourceRef: string }[];
    };
  const dev = await get('development'),
    testing = await get('test');
  assert.equal(dev.project, name);
  assert.equal(testing.project, name);
  assert.notEqual(dev.volumes[0]!.resourceRef, testing.volumes[0]!.resourceRef);
  assert.ok(dev.volumes[0]!.resourceRef.length <= 63);
  assert.ok(testing.volumes[0]!.resourceRef.length <= 63);
  assert.equal(
    serviceResourceName(name, 'development'),
    serviceResourceName(name, 'development'),
  );
  assert.notEqual(
    serviceResourceName(name, 'development'),
    serviceResourceName(name.slice(0, 63) + 'b', 'development'),
  );
  assert.equal((await invoke(root, ['services', 'plan'], noExecution)).code, 0);
  for (const length of [1, 48, 49, 63, 64])
    assert.equal(
      describeServices(
        {
          schemaVersion: 1,
          project: { name: 'a'.repeat(length), packageManager: 'npm' },
          capabilities: {
            foundation: { recipe: 'foundation.nest', options: {} },
          },
        },
        [],
      ).project.length,
      length,
    );
});

test('actual JSON dev refuses before runtime; source-only actual dev/release do not install implicitly', async (t) => {
  const root = await fixture(t);
  assert.equal(
    (await invoke(root, ['dev'], noExecution)).result.errors?.[0]?.code,
    'JSON_DEV_REQUIRES_DRY_RUN',
  );
  assert.equal(
    (await invoke(root, ['dev'], noExecution, false)).result.errors?.[0]?.code,
    'OPERATION_DEPENDENCIES_PENDING',
  );
  assert.equal(
    (await invoke(root, ['release', 'apply'], noExecution)).result.errors?.[0]
      ?.code,
    'OPERATION_DEPENDENCIES_PENDING',
  );
});

test('dev reports missing configuration before launching a watcher or taking ownership', async (t) => {
  const root = await fixture(t, { installed: true });
  await rm(path.join(root, '.env.development'), { force: true });
  const outcome = await invoke(
    root,
    ['dev'],
    {
      ...noExecution,
      environment: () => ({ PRIVATE_SENTINEL: 'fixture-only' }),
    },
    false,
  );
  const error = outcome.result.errors?.[0];
  assert.equal(error?.code, 'DEV_CONFIG_REQUIRED');
  assert.match(error.action, /DATABASE_URL.*--config-file/);
  assert.equal(error.action.includes('fixture-only'), false);
  await assert.rejects(
    stat(path.join(root, '.vcli/local/dev-development.lock')),
    { code: 'ENOENT' },
  );
});

test('dev uses the private development config by default', async (t) => {
  const root = await fixture(t, { installed: true });
  const configFile = path.join(root, '.env.development');
  await writeFile(configFile, 'NODE_ENV=development\n', { mode: 0o600 });
  let called = false;
  const result = await invoke(
    root,
    ['dev', '--port', String(await freePort())],
    {
      ...noExecution,
      environment: () => ({}),
      devRunner: async ({ environment }) => {
        called = true;
        assert.equal(environment.APP_ENV_FILE, configFile);
        return { code: 0, stdout: '' };
      },
    },
    false,
  );
  assert.equal(called, true);
  assert.equal(result.code, 0);
});

test('human dev delegates local Nest with explicit test environment and propagates actual exit code', async (t) => {
  const root = await fixture(t, { installed: true }),
    selectedPort = await freePort();
  let called = 0;
  const environment = () => ({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://127.0.0.1/fixture',
    PRIVATE_SENTINEL: 'PRIVATE_SENTINEL',
  });
  const args = ['dev', '--environment', 'test', '--port', String(selectedPort)];
  const outcome = await invoke(
    root,
    args,
    {
      environment,
      devRunner: async (invocation) => {
        called++;
        assert.equal(invocation.command, process.execPath);
        assert.equal(invocation.environment.NODE_ENV, 'test');
        assert.equal(invocation.environment.PORT, String(selectedPort));
        assert.deepEqual(invocation.args.slice(1), ['start', '--watch']);
        const duplicate = await invoke(
          root,
          args,
          { ...noExecution, environment },
          false,
        );
        const error = duplicate.result.errors?.[0];
        assert.equal(error?.code, 'LOCAL_OPERATION_OWNERSHIP_CONFLICT');
        assert.match(error.action, /Stop it in the IDE or terminal/);
        return { code: 130, signal: 'SIGINT', stdout: 'PRIVATE_SENTINEL' };
      },
    },
    false,
  );
  assert.equal(called, 1);
  assert.equal(outcome.code, 130);
  assert.equal((outcome.result.data as { exitCode: number }).exitCode, 130);
});

test('service delegated failure/signal code survives the shared failed envelope', async (t) => {
  const root = await fixture(t);
  let called = 0;
  const outcome = await invoke(root, ['services', 'up'], {
    serviceRunner: async () => {
      called++;
      return { code: 143, signal: 'SIGTERM', stdout: 'PRIVATE_SENTINEL' };
    },
  });
  assert.equal(called, 1);
  assert.equal(outcome.code, 143);
  assert.equal(outcome.result.status, 'failed');
  assert.equal((outcome.result.data as { signal: string }).signal, 'SIGTERM');
});

test('all finite release actions delegate only managed scripts with private input out of argv/output', async (t) => {
  const root = await fixture(t, { installed: true }),
    profile = path.join(root, 'PRIVATE_SENTINEL.json');
  await writeFile(profile, 'PRIVATE_SENTINEL', { mode: 0o600 });
  for (const [action, script, key] of [
    ['apply', 'release:apply', undefined],
    ['backup', 'backup:create', 'VCLI_BACKUP_PROFILE'],
    ['restore', 'backup:restore', 'VCLI_RESTORE_PROFILE'],
    ['reconcile', 'release:reconcile', 'VCLI_RELEASE_DECISION'],
  ] as const) {
    let called = 0;
    const environment = { DATABASE_URL: 'PRIVATE_SENTINEL' };
    const outcome = await invoke(
      root,
      [
        'release',
        action,
        ...(key
          ? [action === 'reconcile' ? '--decision' : '--profile', profile]
          : []),
      ],
      {
        environment: () => environment,
        releaseRunner: async (invocation) => {
          called++;
          assert.equal(invocation.command, 'npm');
          assert.deepEqual(invocation.args, [
            'run',
            '--silent',
            '--ignore-scripts',
            script,
          ]);
          assert.equal(invocation.cwd, root);
          if (key) assert.equal(invocation.environment[key], profile);
          return { code: 0, stdout: 'PRIVATE_SENTINEL' };
        },
      },
    );
    assert.equal(called, 1);
    assert.equal(outcome.code, 0);
    assert.deepEqual(environment, { DATABASE_URL: 'PRIVATE_SENTINEL' });
  }
});

test('release refuses missing DB, wrong/missing private inputs, unsafe files and changed managed scripts', async (t) => {
  const plain = await fixture(t, { database: false });
  assert.equal(
    (await invoke(plain, ['release', 'apply', '--dry-run'], noExecution)).result
      .errors?.[0]?.code,
    'RELEASE_DATABASE_REQUIRED',
  );
  const root = await fixture(t, { installed: true });
  assert.equal(
    (await invoke(root, ['release', 'backup'], noExecution)).result.errors?.[0]
      ?.code,
    'RELEASE_PRIVATE_INPUT_REQUIRED',
  );
  assert.equal(
    (
      await invoke(
        root,
        ['release', 'apply', '--profile', 'PRIVATE_SENTINEL', '--dry-run'],
        noExecution,
      )
    ).result.errors?.[0]?.code,
    'INVALID_RELEASE_INPUT',
  );
  const profile = path.join(root, 'unsafe-profile.json');
  await writeFile(profile, 'PRIVATE_SENTINEL', { mode: 0o644 });
  assert.equal(
    (
      await invoke(
        root,
        ['release', 'restore', '--profile', profile],
        noExecution,
      )
    ).result.errors?.[0]?.code,
    'UNSAFE_PRIVATE_OPERATION_FILE',
  );
  const manifest = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  manifest.scripts['release:apply'] = 'node PRIVATE_SENTINEL.js';
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  assert.equal(
    (await invoke(root, ['release', 'apply', '--dry-run'], noExecution)).result
      .errors?.[0]?.code,
    'OPERATIONAL_STATE_CONFLICT',
  );
});

test('owned-process signal mapping preserves SIGKILL137 without launching a process', async () => {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid: 765432, exitCode: null, signalCode: null });
  const result = runOwnedProcess(
    { command: 'fixture', args: [], cwd: '.', environment: {} },
    { launch: () => child },
  );
  child.emit('close', null, 'SIGKILL');
  assert.deepEqual(await result, { code: 137, signal: 'SIGKILL', stdout: '' });
});

test('isolated child CLI registration emits one safe envelope and preserves delegated exit status', async (t) => {
  const root = await fixture(t, { installed: true });
  const moduleUrl = new URL(
    '../dist/commands/operational-commands.js',
    import.meta.url,
  ).href;
  const outputUrl = new URL(
    '../dist/commands/command-output.js',
    import.meta.url,
  ).href;
  const wrapper = path.join(path.dirname(root), 'operation-cli.mjs');
  await writeFile(
    wrapper,
    `import {Command} from 'commander';
import {registerOperationalCommands} from ${JSON.stringify(moduleUrl)};
import {writeResult,publicError} from ${JSON.stringify(outputUrl)};
const program=new Command().exitOverride().option('--json').option('--project <root>');let operation='cli';program.configureOutput({writeOut:()=>{},writeErr:()=>{},outputError:()=>{}});
const emit=result=>{writeResult(result,true);if(result.status==='failed')process.exitCode=1;};
const fake=async()=>({code:Number(process.env.OPS_FIXTURE_EXIT_CODE??0),stdout:'PRIVATE_SENTINEL'});
registerOperationalCommands(program,{project:()=>program.opts().project,json:()=>!!program.opts().json,setOperation:value=>{operation=value;},emit},{serviceRunner:fake,releaseRunner:fake,devRunner:fake});
try{await program.parseAsync(process.argv);}catch(error){emit({schemaVersion:1,status:'failed',operation,errors:[publicError(error)]});}
`,
  );
  for (const [args, code] of [
    [['services', 'plan'], 0],
    [['release', 'apply'], 137],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      [wrapper, '--project', root, '--json', ...args],
      {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          OPS_FIXTURE_EXIT_CODE: String(code),
          PRIVATE_SENTINEL: 'PRIVATE_SENTINEL',
        },
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, code, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 1);
    const parsed = JSON.parse(result.stdout) as CommandResult;
    assert.equal(parsed.schemaVersion, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SENTINEL/);
    assert.equal(result.stdout.includes(root), false);
  }
  await assert.rejects(stat(path.join(root, 'dist', 'PRIVATE_SENTINEL.js')), {
    code: 'ENOENT',
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve('.');
const evidence = join(repository, 'var/cli-evidence/identity');
await mkdir(evidence, { recursive: true, mode: 0o700 });
const resume = process.env.VCLI_IDENTITY_GATE_WORKSPACE;
const workspace =
  resume ?? (await mkdtemp(join(tmpdir(), 'vcli-identity-gate-')));
const prior = resume
  ? JSON.parse(await readFile(join(evidence, 'results.json'), 'utf8'))
  : undefined;
if (resume) {
  assert.equal(prior.facts.workspace, resume);
  assert.ok(resume.startsWith(join(tmpdir(), 'vcli-identity-gate-')));
}
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  NODE_ENV: 'test',
  NO_COLOR: '1',
};
const records: { name: string; exitCode: number | null; elapsedMs: number }[] =
  [];
if (prior)
  records.push(
    ...prior.records.filter(
      (record: { exitCode: number }) => record.exitCode === 0,
    ),
  );
const facts: Record<string, unknown> = {
  workspace,
  ...(prior ? { resumedArtifact: prior.facts.artifact } : {}),
};
let taskContainer: string | undefined,
  taskContainerOwned = false,
  success = false;
const privateValues: string[] = [];
const docker = ['sudo', '-n', 'docker'];
const images = {
  mongodb:
    'mongo@sha256:9b73c38e39783bd21335f603a9f08be60fe385f5c28933ea32bb4a9fa1fd6d23',
  postgres:
    'postgres@sha256:63e83b5a3dc36a917dccb76fe1bd2ac51f1ec9c1deb47ff20d4f04233bf6eae9',
};
function redact(text: string): string {
  for (const value of privateValues)
    if (value.length >= 16) text = text.replaceAll(value, '[REDACTED]');
  return text.replace(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    '[REDACTED-JWT]',
  );
}
async function run(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  extra: NodeJS.ProcessEnv = {},
  timeout = 180000,
): Promise<string> {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: { ...env, ...extra },
    encoding: 'utf8',
    timeout,
    maxBuffer: 16000000,
  });
  records.push({
    name,
    exitCode: result.status,
    elapsedMs: Date.now() - started,
  });
  await writeFile(
    join(evidence, name + '.log'),
    redact(result.stdout + result.stderr),
    { mode: 0o600 },
  );
  console.log(name + ': ' + (result.status === 0 ? 'passed' : 'FAILED'));
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'See sanitized ' + name + '.log');
  return result.stdout;
}
function native(args: string[], check = true): string {
  const result = spawnSync(docker[0]!, [...docker.slice(1), ...args], {
    env,
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 1000000,
  });
  if (check) {
    assert.ifError(result.error);
    assert.equal(result.status, 0, 'NATIVE_TASK_OPERATION_FAILED');
  }
  return result.status === 0 ? result.stdout : '';
}
async function untilReady(args: string[]): Promise<void> {
  for (let count = 0; count < 50; count++) {
    if (native(['exec', taskContainer!, ...args], false)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('NATIVE_TASK_READINESS_TIMEOUT');
}
function cleanupDatabase(): void {
  if (taskContainer && taskContainerOwned) {
    native(['stop', '--time', '5', taskContainer], false);
    native(['rm', '--volumes', taskContainer], false);
    taskContainer = undefined;
    taskContainerOwned = false;
  }
}
try {
  const pack = join(workspace, 'pack');
  await mkdir(pack, { recursive: true });
  const packed = prior
    ? { filename: prior.facts.artifact.name, size: prior.facts.artifact.bytes }
    : JSON.parse(
        await run(
          'pack',
          'npm',
          ['pack', '--ignore-scripts', '--pack-destination', pack, '--json'],
          repository,
        ),
      )[0];
  const tarball = join(pack, packed.filename);
  facts.artifact = {
    name: packed.filename,
    sha256: createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex'),
    bytes: packed.size,
  };
  if (prior)
    assert.equal(
      (facts.artifact as { sha256: string }).sha256,
      prior.facts.artifact.sha256,
    );
  const tool = join(workspace, 'tool');
  await mkdir(tool, { recursive: true });
  await writeFile(
    join(tool, 'package.json'),
    JSON.stringify({
      name: 'identity-tool-consumer',
      private: true,
      dependencies: { '@vcli/cli': 'file:' + tarball },
    }),
  );
  if (!prior)
    await run(
      'install-packed-cli',
      'npm',
      ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
      tool,
    );
  const cli = join(tool, 'node_modules/@vcli/cli/bin/vcli.mjs');
  const profiles: Record<string, unknown>[] = [];
  const alreadyPassed = (name: string) =>
    Boolean(
      prior &&
      prior.records.some(
        (record: { name: string; exitCode: number }) =>
          record.name === name + '-http' && record.exitCode === 0,
      ) &&
      (!name.endsWith('-local') ||
        prior.records.some(
          (record: { name: string; exitCode: number }) =>
            record.name === name + '-diagnostic-check' && record.exitCode === 0,
        )),
    );
  const recoveredProfile = async (driver: string, auth: string) => {
    const output = await readFile(
      join(evidence, driver + '-' + auth + '-http.log'),
      'utf8',
    );
    return {
      driver,
      auth,
      ...JSON.parse(
        output
          .split('\n')
          .find((line) => line.startsWith('VCLI_ACCEPTANCE '))!
          .slice('VCLI_ACCEPTANCE '.length),
      ),
    };
  };
  for (const driver of ['postgres', 'mongodb'] as const) {
    if (
      ['local', 'firebase'].every((auth) => alreadyPassed(driver + '-' + auth))
    ) {
      for (const auth of ['local', 'firebase'])
        profiles.push(await recoveredProfile(driver, auth));
      continue;
    }
    const suffix = randomBytes(5).toString('hex');
    taskContainer = 'vcli-identity-' + driver + '-' + suffix;
    const password = randomBytes(24).toString('hex');
    privateValues.push(password);
    const args = [
      'run',
      '-d',
      '--pull',
      'never',
      '--name',
      taskContainer,
      '--label',
      'vcli.cli-identity.task=' + suffix,
      '--network',
      'my-first-project-orcaserver-bwwu6y_default',
      '--cgroup-parent',
      'orca.slice',
      '--memory',
      driver === 'mongodb' ? '512m' : '192m',
      '--cpus',
      driver === 'mongodb' ? '0.75' : '0.5',
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
    args.push(images[driver]);
    if (driver === 'mongodb')
      args.push(
        'mongod',
        '--replSet',
        'rs0',
        '--bind_ip_all',
        '--wiredTigerCacheSizeGB',
        '0.25',
      );
    native(args);
    taskContainerOwned = true;
    await untilReady(
      driver === 'postgres'
        ? ['pg_isready', '-U', 'fixture', '-d', 'fixture']
        : ['mongosh', '--quiet', '--eval', 'db.adminCommand({ping:1})'],
    );
    if (driver === 'mongodb') {
      native([
        'exec',
        taskContainer,
        'mongosh',
        '--quiet',
        '--eval',
        'rs.initiate({_id:"rs0",members:[{_id:0,host:"' +
          taskContainer +
          ':27017"}]})',
      ]);
      await untilReady([
        'mongosh',
        '--quiet',
        '--eval',
        'if(!db.hello().isWritablePrimary)quit(1);print("ready")',
      ]);
    }
    for (const auth of ['local', 'firebase'] as const) {
      if (alreadyPassed(driver + '-' + auth)) {
        profiles.push(await recoveredProfile(driver, auth));
        continue;
      }
      const name = driver + '-' + auth,
        project = join(workspace, name),
        database = 'fixture_' + auth;
      if (driver === 'postgres')
        native([
          'exec',
          taskContainer,
          'psql',
          '-U',
          'fixture',
          '-d',
          'fixture',
          '-c',
          'CREATE DATABASE ' + database,
        ]);
      const url =
        driver === 'postgres'
          ? 'postgresql://fixture:' +
            password +
            '@' +
            taskContainer +
            ':5432/' +
            database
          : 'mongodb://' +
            taskContainer +
            ':27017/' +
            database +
            '?replicaSet=rs0&directConnection=true';
      privateValues.push(url);
      const options = [
        'init',
        project,
        '--name',
        'identity-' + name,
        '--database',
        driver,
        '--auth',
        auth,
        '--diagnostics',
        '--evidence-sources',
        auth === 'local'
          ? 'application,workers,database,infrastructure,tests'
          : 'application,database',
        '--skip-install',
        '--yes',
        '--json',
      ];
      if (auth === 'local')
        options.push(
          '--mail',
          'capture',
          '--reliable-actions',
          '--test-evidence',
        );
      const reused = Boolean(
        prior && existsSync(join(project, 'vcli.lock.json')),
      );
      if (!reused) {
        const initialized = JSON.parse(
          await run(
            name + '-generate',
            process.execPath,
            [cli, ...options],
            workspace,
          ),
        );
        assert.notEqual(initialized.status, 'failed');
        await run(
          name + '-install',
          process.execPath,
          [cli, '--project', project, 'install', '--offline', '--json'],
          workspace,
        );
        const localCli = join(project, 'node_modules/@vcli/cli/bin/vcli.mjs');
        await run(
          name + '-check',
          process.execPath,
          [localCli, 'check', '--json'],
          project,
        );
        await run(name + '-build', 'npm', ['run', 'build'], project);
        await run(name + '-generated-tests', 'npm', ['test'], project);
      } else {
        const inspected = JSON.parse(
          await run(
            name + '-reuse-inspection',
            process.execPath,
            [cli, '--project', project, 'inspect', '--json'],
            workspace,
          ),
        );
        assert.equal(inspected.data.outcomes.source, 'completed');
        assert.deepEqual(inspected.data.issues, []);
        if (inspected.data.outcomes.install !== 'completed')
          await run(
            name + '-retry-install',
            process.execPath,
            [cli, '--project', project, 'install', '--offline', '--json'],
            workspace,
          );
        const localCli = join(project, 'node_modules/@vcli/cli/bin/vcli.mjs');
        if (inspected.data.outcomes.checks !== 'completed')
          await run(
            name + '-check',
            process.execPath,
            [localCli, 'check', '--json'],
            project,
          );
        if (
          !prior.records.some(
            (record: { name: string; exitCode: number }) =>
              record.name === name + '-build' && record.exitCode === 0,
          ) &&
          prior.facts[name + 'ReusedPassedSourceInstallCheckBuild'] !== true
        ) {
          await run(name + '-build', 'npm', ['run', 'build'], project);
          await run(name + '-generated-tests', 'npm', ['test'], project);
        }
        facts[name + 'ReusedPassedSourceInstallCheckBuild'] = true;
      }
      const runtimeEnv: NodeJS.ProcessEnv = {
        DATABASE_URL: url,
        LOCAL_STORAGE_ROOT: join(project, 'var/storage'),
        EVIDENCE_DIRECTORY: join(project, 'var/evidence'),
      };
      if (auth === 'local') {
        const signing = randomBytes(32).toString('base64url'),
          mailKey = randomBytes(32).toString('base64');
        privateValues.push(signing, mailKey);
        Object.assign(runtimeEnv, {
          JWT_KEYS_JSON: JSON.stringify([{ id: 'active', key: signing }]),
          JWT_ACTIVE_KID: 'active',
          MAIL_DELIVERY_KEYS_JSON: JSON.stringify({ active: mailKey }),
          MAIL_DELIVERY_KEY_ID: 'active',
        });
      } else runtimeEnv.FIREBASE_PROJECT_ID = 'synthetic-project';
      await run(
        name + '-initialize',
        'npm',
        ['run', 'db:initialize'],
        project,
        runtimeEnv,
      );
      await run(
        name + '-repeat-initialize',
        'npm',
        ['run', 'db:initialize'],
        project,
        runtimeEnv,
      );
      await mkdir(join(project, 'var'), { recursive: true, mode: 0o700 });
      await writeFile(
        join(project, 'var/acceptance.mjs'),
        await readFile(
          join(repository, 'test/fixtures/generated-identity.mjs'),
        ),
        { mode: 0o600 },
      );
      const output = await run(
        name + '-http',
        process.execPath,
        ['var/acceptance.mjs'],
        project,
        { ...runtimeEnv, FIXTURE_AUTH: auth },
        240000,
      );
      const result = JSON.parse(
        output
          .split('\n')
          .find((line) => line.startsWith('VCLI_ACCEPTANCE '))!
          .slice('VCLI_ACCEPTANCE '.length),
      );
      profiles.push({ driver, auth, ...result });
      if (auth === 'local')
        await run(
          name + '-diagnostic-check',
          'npm',
          ['run', 'diagnostics:check'],
          project,
          runtimeEnv,
        );
    }
    cleanupDatabase();
  }
  facts.profiles = profiles;
  success = true;
} finally {
  cleanupDatabase();
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(
      { status: success ? 'passed' : 'failed', facts, records },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  if (success) {
    await rm(workspace, { recursive: true, force: true });
    console.log(
      'Packed four-way identity gate passed; task databases and temporary projects removed.',
    );
  } else
    console.log(
      'Gate failed; task databases removed and private fixture preserved for diagnosis.',
    );
}

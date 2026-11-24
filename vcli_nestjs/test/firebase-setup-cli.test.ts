import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const vcli = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));
const fakeProgram = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const [command, projectId] = args;
const log = process.env.VCLI_FAKE_FIREBASE_LOG;
const state = process.env.VCLI_FAKE_FIREBASE_PROJECTS;
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
const projects = JSON.parse(fs.readFileSync(state, 'utf8'));

if (process.env.VCLI_FAKE_FIREBASE_FAILURE) {
  console.error('PRIVATE_FIREBASE_CLI_OUTPUT');
  console.log(JSON.stringify({status:'error',error:'PRIVATE_FIREBASE_CLI_OUTPUT'}));
  process.exit(1);
}

if (!args.includes('--json') || !args.includes('--non-interactive')) process.exit(2);
if (command === 'projects:list') {
  console.log(JSON.stringify({status:'success',result:projects}));
} else if (command === 'projects:create' && projectId && !projects.some(project => project.projectId === projectId)) {
  const project = {projectId,displayName:projectId};
  fs.writeFileSync(state, JSON.stringify([...projects,project]));
  console.log(JSON.stringify({status:'success',result:project}));
} else {
  process.exit(2);
}
`;

interface CliResult {
  status: string;
  operation: string;
  schemaVersion: number;
  errors?: { code: string }[];
  data?: { projectAction?: string; projectId?: string };
}

function invoke(
  cwd: string,
  environment: NodeJS.ProcessEnv,
  ...args: string[]
) {
  const child = spawnSync(process.execPath, [vcli, ...args, '--json'], {
    cwd,
    env: environment,
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.ifError(child.error);
  assert.doesNotMatch(
    child.stdout + child.stderr,
    /FIREBASE_TEST_KEY_SENTINEL|PRIVATE_FIREBASE_CLI_OUTPUT|PRIVATE_FIREBASE_ENV_VALUE/,
  );
  const lines = child.stdout.trim().split('\n');
  assert.equal(lines.length, 1, 'JSON mode emits exactly one result');
  const result = JSON.parse(lines[0]!) as CliResult;
  assert.equal(result.schemaVersion, 1);
  return { code: child.status, result };
}

async function generatedProject(t: TestContext, ...capabilities: string[]) {
  const directory = await mkdtemp(
    join(await realpath(tmpdir()), 'vcli-firebase-setup-'),
  );
  t.after(() => rm(directory, { recursive: true }));
  const logFile = join(directory, 'firebase-calls.jsonl');
  const state = join(directory, 'firebase-projects.json');
  await writeFile(logFile, '');
  await writeFile(
    state,
    JSON.stringify([
      { projectId: 'fixture-auth', displayName: 'Fixture Auth' },
      { projectId: 'fixture-fcm', displayName: 'Fixture FCM' },
    ]),
  );
  await writeFile(join(directory, 'firebase'), fakeProgram, { mode: 0o700 });
  const environment = {
    PATH: [directory, process.env.PATH].join(delimiter),
    VCLI_FAKE_FIREBASE_LOG: logFile,
    VCLI_FAKE_FIREBASE_PROJECTS: state,
  };
  const initialized = invoke(
    directory,
    environment,
    'init',
    'api',
    '--yes',
    '--skip-install',
    '--database',
    'mongodb',
    '--auth',
    'firebase',
    '--firebase-methods',
    'email-password',
    ...capabilities,
  );
  assert.equal(initialized.code, 0, JSON.stringify(initialized.result));
  const project = join(directory, 'api');
  return {
    project,
    envFile: join(project, '.env.development'),
    credentialFile: join(project, 'firebase-admin.json'),
    setup: (...args: string[]) =>
      invoke(
        directory,
        environment,
        '--project',
        project,
        'firebase',
        'setup',
        ...args,
      ),
    failProvider: (...args: string[]) =>
      invoke(
        directory,
        { ...environment, VCLI_FAKE_FIREBASE_FAILURE: 'true' },
        '--project',
        project,
        'firebase',
        'setup',
        ...args,
      ),
    calls: async () =>
      (await readFile(logFile, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
  };
}

async function writeCredentials(file: string, projectId: string) {
  const contents = JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    client_email: 'fixture-admin@example.invalid',
    private_key: 'FIREBASE_TEST_KEY_SENTINEL',
  });
  await writeFile(file, contents, { mode: 0o600 });
  return contents;
}

test('Firebase setup wires a root service-account file and preserves generated and developer env', async (t) => {
  const { project, envFile, credentialFile, setup, failProvider, calls } =
    await generatedProject(t);
  const git = (...args: string[]) =>
    spawnSync('git', args, { cwd: project, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  const credentials = await writeCredentials(credentialFile, 'fixture-auth');
  assert.equal(
    git('check-ignore', '-q', '--', 'firebase-admin.json').status,
    0,
  );

  const initialEnv = await readFile(envFile, 'utf8');
  const ownerSetting =
    '# Keep this comment\nCUSTOM="PRIVATE_FIREBASE_ENV_VALUE"\n';
  await writeFile(envFile, initialEnv + ownerSetting);

  const failure = failProvider('--existing', 'fixture-auth');
  assert.equal(failure.code, 1);
  assert.equal(failure.result.operation, 'firebase.setup');
  assert.equal(await readFile(envFile, 'utf8'), initialEnv + ownerSetting);

  const linked = setup('--existing', 'fixture-auth');
  assert.equal(linked.code, 0, JSON.stringify(linked.result));
  assert.equal(linked.result.status, 'completed');
  const configured = await readFile(envFile, 'utf8');
  assert.ok(configured.includes(initialEnv + ownerSetting));
  const environment = parseEnv(configured);
  assert.equal(environment.FIREBASE_PROJECT_ID, 'fixture-auth');
  assert.equal(
    environment.GOOGLE_APPLICATION_CREDENTIALS,
    './firebase-admin.json',
  );
  assert.equal(environment.FCM_PROJECT_ID, undefined);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
  assert.equal(await readFile(credentialFile, 'utf8'), credentials);
  assert.ok((await calls()).every(([command]) => command === 'projects:list'));

  const repeated = setup('--existing', 'fixture-auth');
  assert.equal(repeated.code, 0, JSON.stringify(repeated.result));
  assert.equal(await readFile(envFile, 'utf8'), configured);
  // The generated runtime also accepts colon-separated dotenv assignments.
  const runtimeSyntax = configured.replace(
    'FIREBASE_PROJECT_ID=fixture-auth',
    'FIREBASE_PROJECT_ID: fixture-auth',
  );
  await writeFile(envFile, runtimeSyntax);
  const switchProject = setup('--existing', 'fixture-fcm', '--adc');
  assert.equal(switchProject.code, 1);
  assert.equal(
    switchProject.result.errors?.[0]?.code,
    'FIREBASE_PROJECT_LINK_CONFLICT',
  );
  assert.equal(await readFile(envFile, 'utf8'), runtimeSyntax);
});

test('Firebase dry run skips private files and provider calls, then create can resume after credential download', async (t) => {
  const { project, envFile, credentialFile, setup, calls } =
    await generatedProject(t);
  const initial = await readFile(envFile, 'utf8');
  await writeFile(credentialFile, 'FIREBASE_TEST_KEY_SENTINEL');
  const entries = await readdir(project);
  const conflicting = setup(
    '--create',
    'fixture-created',
    '--existing',
    'fixture-auth',
  );
  assert.equal(conflicting.code, 1);
  const preview = setup('--create', 'fixture-created', '--dry-run');
  assert.equal(preview.code, 0, JSON.stringify(preview.result));
  assert.equal(preview.result.status, 'preview');
  assert.deepEqual(await calls(), []);
  assert.deepEqual(await readdir(project), entries);
  assert.equal(await readFile(envFile, 'utf8'), initial);
  await rm(credentialFile);

  const created = setup('--create', 'fixture-created');
  assert.equal(created.code, 0, JSON.stringify(created.result));
  assert.equal(created.result.status, 'pending');
  assert.equal(created.result.data?.projectAction, 'created');
  const configured = await readFile(envFile, 'utf8');
  const environment = parseEnv(configured);
  assert.equal(environment.FIREBASE_PROJECT_ID, 'fixture-created');
  assert.equal(
    environment.GOOGLE_APPLICATION_CREDENTIALS,
    './firebase-admin.json',
  );

  await writeCredentials(credentialFile, 'fixture-created');
  const repeated = setup('--create', 'fixture-created');
  assert.equal(repeated.code, 0, JSON.stringify(repeated.result));
  assert.equal(repeated.result.status, 'completed');
  assert.equal(repeated.result.data?.projectAction, 'reused');
  assert.equal(await readFile(envFile, 'utf8'), configured);
  const createCalls = (await calls()).filter(
    ([command]) => command === 'projects:create',
  );
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]?.[1], 'fixture-created');
});

test('Firebase setup scopes FCM separately and rejects a mismatched root credential', async (t) => {
  const { envFile, credentialFile, setup } = await generatedProject(
    t,
    '--push',
    'fcm',
  );
  const initial = await readFile(envFile, 'utf8');
  await writeCredentials(credentialFile, 'fixture-auth');
  const mismatch = setup('--for', 'fcm', '--existing', 'fixture-fcm');
  assert.equal(mismatch.code, 1);
  assert.equal(await readFile(envFile, 'utf8'), initial);

  await writeCredentials(credentialFile, 'fixture-fcm');
  await chmod(credentialFile, 0o644);
  const linked = setup('--for', 'fcm', '--existing', 'fixture-fcm');
  assert.equal(linked.code, 0, JSON.stringify(linked.result));
  const configured = parseEnv(await readFile(envFile, 'utf8'));
  assert.equal(configured.FCM_PROJECT_ID, 'fixture-fcm');
  assert.equal(configured.FCM_CREDENTIALS_PATH, './firebase-admin.json');
  assert.equal(configured.FIREBASE_PROJECT_ID, undefined);
  assert.equal(configured.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);

  const auth = setup('--for', 'auth', '--existing', 'fixture-auth', '--adc');
  assert.equal(auth.code, 0, JSON.stringify(auth.result));
  const separatelyLinked = parseEnv(await readFile(envFile, 'utf8'));
  assert.equal(separatelyLinked.FIREBASE_PROJECT_ID, 'fixture-auth');
  assert.equal(separatelyLinked.FCM_PROJECT_ID, 'fixture-fcm');
  assert.equal(separatelyLinked.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});

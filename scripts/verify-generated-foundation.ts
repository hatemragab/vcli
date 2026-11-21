import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';

const repository = resolve('.');
const evidence = join(repository, 'var/cli-evidence/foundation');
await mkdir(evidence, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), 'vcli-generated-gate-'));
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'C.UTF-8',
  NODE_ENV: 'test',
  NO_COLOR: '1',
};
const records: {
  name: string;
  command: string;
  exitCode: number | null;
  elapsedMs: number;
}[] = [];
const facts: Record<string, unknown> = {};
const sentinel = 'SYNTHETIC_PRIVATE_CONFIG_SENTINEL';
let child: ReturnType<typeof spawn> | undefined;
let success = false;
function run(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  expected = 0,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8_000_000,
  });
  const record = {
    name,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    elapsedMs: Date.now() - started,
  };
  records.push(record);
  const output = (result.stdout + result.stderr).replaceAll(
    sentinel,
    '[REDACTED]',
  );
  writeFileSync(join(evidence, `${name}.log`), output, { mode: 0o600 });
  process.stdout.write(
    `${name}: ${result.status === expected ? 'passed' : 'FAILED'} (${record.elapsedMs}ms)\n`,
  );
  assert.ifError(result.error);
  assert.equal(result.status, expected, `See sanitized ${name}.log`);
  return result.stdout;
}
function cli(name: string, executable: string, args: string[], cwd: string) {
  const value = JSON.parse(
    run(name, process.execPath, [executable, ...args, '--json'], cwd),
  );
  assert.notEqual(value.status, 'failed');
  return value;
}
try {
  const packDir = join(workspace, 'pack');
  await mkdir(packDir);
  const packed = JSON.parse(
    run(
      'pack',
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', packDir, '--json'],
      repository,
    ),
  )[0];
  assert.ok(
    packed.files.some(
      (file: { path: string }) =>
        file.path === 'runtime-packages/auth-runtime/package.json',
    ),
  );
  assert.ok(
    packed.files.every(
      (file: { path: string }) =>
        !/(^|\/)(node_modules|var|\.git)(\/|$)/.test(file.path),
    ),
  );
  const tarball = join(packDir, packed.filename);
  facts.package = {
    filename: packed.filename,
    size: packed.size,
    sha256: createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex'),
  };
  const tool = join(workspace, 'tool');
  await mkdir(tool);
  await writeFile(
    join(tool, 'package.json'),
    JSON.stringify({
      name: 'private-cli-consumer',
      private: true,
      dependencies: { '@vcli/cli': `file:${tarball}` },
    }),
  );
  run(
    'install-packed-tool',
    'npm',
    ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    tool,
  );
  const executable = join(tool, 'node_modules/@vcli/cli/bin/vcli.mjs');
  cli(
    'init',
    executable,
    ['init', 'app', '--name', 'generated-gate', '--yes', '--skip-install'],
    workspace,
  );
  const app = join(workspace, 'app');
  cli(
    'install-app',
    executable,
    ['--project', app, 'install', '--offline'],
    workspace,
  );
  const localCli = join(app, 'node_modules/@vcli/cli/bin/vcli.mjs');
  cli('check-app', localCli, ['check'], app);
  const manifest = JSON.parse(
    await readFile(join(app, 'package.json'), 'utf8'),
  );
  for (const forbidden of [
    'mongoose',
    'pg',
    'drizzle-orm',
    'firebase-admin',
    'argon2',
    'jose',
    'nodemailer',
    '@aws-sdk/client-s3',
  ])
    assert.equal(manifest.dependencies[forbidden], undefined);
  run('build-app', 'npm', ['run', 'build'], app);
  run('test-app', 'npm', ['test'], app);
  const reservation = net.createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const address = reservation.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  child = spawn(process.execPath, ['dist/main.js'], {
    cwd: app,
    env: {
      ...env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk) => {
      if (logs.length < 64_000) logs += String(chunk);
    });
  const stopped = new Promise((resolve) =>
    child!.once('exit', (code, signal) => resolve({ code, signal })),
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const live = await fetch(`http://127.0.0.1:${port}/health/live`),
        ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (live.ok && ready.ok) {
        facts.health = { live: await live.json(), ready: await ready.json() };
        break;
      }
    } catch {
      /* Readiness is bounded; no other process is stopped. */
    }
    if (attempt === 99) throw new Error('GENERATED_APP_BOOT_FAILED');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  facts.shutdown = await Promise.race([
    stopped,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('GENERATED_APP_STOP_TIMEOUT')), 10_000),
    ),
  ]);
  assert.match(logs, /application.started/);
  assert.match(logs, /application.stopped/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health/live`));
  child = undefined;
  const invalid = run(
    'invalid-config',
    process.execPath,
    ['dist/main.js'],
    app,
    1,
    { PORT: sentinel },
  );
  assert.doesNotMatch(invalid, new RegExp(sentinel));
  const customPath = join(app, 'src/app.custom.module.ts');
  let custom =
    (await readFile(customPath, 'utf8')) +
    '\n// developer integration survives add\n';
  await writeFile(customPath, custom);
  const privatePath = join(app, '.env.development');
  await writeFile(privatePath, `PRIVATE_CONFIG=${sentinel}\n`, { mode: 0o600 });
  const packagePath = join(app, 'package.json');
  const customized = JSON.parse(await readFile(packagePath, 'utf8'));
  customized.scripts['custom:check'] = 'node -e "process.exit(0)"';
  await writeFile(packagePath, JSON.stringify(customized, null, 2) + '\n');
  cli(
    'add-capture',
    localCli,
    ['add', 'mail.capture', '--offline', '--check'],
    app,
  );
  assert.equal(await readFile(customPath, 'utf8'), custom);
  assert.equal(
    await readFile(privatePath, 'utf8'),
    `PRIVATE_CONFIG=${sentinel}\n`,
  );
  assert.equal(
    JSON.parse(await readFile(packagePath, 'utf8')).scripts['custom:check'],
    customized.scripts['custom:check'],
  );
  const repeated = cli(
    'repeat-capture',
    localCli,
    ['add', 'mail.capture', '--skip-install'],
    app,
  );
  assert.deepEqual(repeated.data.changed, []);
  run('build-capture', 'npm', ['run', 'build'], app);
  run('test-capture', 'npm', ['test'], app);
  const consumer = join(app, 'src/modules/mail-consumer');
  cli(
    'scaffold-explicit-consumer',
    localCli,
    ['g', 'feature', 'mail-consumer', '--use', 'mail', '--offline', '--check'],
    app,
  );
  await writeFile(
    join(consumer, 'mail-consumer.service.ts'),
    `import {Injectable,Inject} from '@nestjs/common';
import {MailService} from '../mail/mail.service.js';
@Injectable()
export class MailConsumerService {
 constructor(@Inject(MailService) private readonly mail:MailService){}
 submit(){return this.mail.submit({operationId:'12345678-1234-4123-8123-123456789abc',purpose:'notification',to:'reader@example.invalid',subject:'Example',text:'SYNTHETIC_CAPTURE_BODY_SENTINEL'});}
}
`,
  );
  const consumerModule = await readFile(
    join(consumer, 'mail-consumer.module.ts'),
    'utf8',
  );
  assert.match(consumerModule, /imports: \[capabilities.mail\]/);
  custom = `import {Module,type DynamicModule} from '@nestjs/common';
import {MailConsumerModule} from './modules/mail-consumer/mail-consumer.module.js';
// developer integration survives add and generation
@Module({})
export class AppCustomModule {static register(capabilities:Readonly<Record<string,DynamicModule>>):DynamicModule{const mail=capabilities.mail;if(!mail)throw new Error('MAIL_REQUIRED');return {module:AppCustomModule,imports:[MailConsumerModule.register({mail})]};}}
`;
  await writeFile(customPath, custom);
  await writeFile(
    join(app, 'probe-mail.mjs'),
    `import {createApp} from './dist/create-app.js';
import {loadConfig} from './dist/core/config/load-config.js';
import {MailConsumerService} from './dist/modules/mail-consumer/mail-consumer.service.js';
const negative=process.argv.includes('--deny');let runtime;
try {runtime=await createApp(loadConfig({NODE_ENV:'test'}));if(negative)process.exitCode=2;else {const outcome=await runtime.app.get(MailConsumerService).submit();if(outcome.status!=='captured')process.exitCode=3;else console.log('DI_CAPTURED');}}
catch{if(negative)console.log('DI_DENIED');else process.exitCode=1;}
finally{if(runtime)await runtime.close();}
`,
  );
  run('build-explicit-consumer', 'npm', ['run', 'build'], app);
  const injected = run(
    'explicit-consumer',
    process.execPath,
    ['probe-mail.mjs'],
    app,
  );
  assert.match(injected, /DI_CAPTURED/);
  assert.doesNotMatch(injected, /SYNTHETIC_CAPTURE_BODY_SENTINEL/);
  await writeFile(
    join(consumer, 'mail-consumer.module.ts'),
    consumerModule.replace('imports: [capabilities.mail]', 'imports: []'),
  );
  run('build-missing-consumer-import', 'npm', ['run', 'build'], app);
  const denied = run(
    'missing-consumer-import',
    process.execPath,
    ['probe-mail.mjs', '--deny'],
    app,
  );
  assert.match(denied, /DI_DENIED/);
  await writeFile(join(consumer, 'mail-consumer.module.ts'), consumerModule);
  facts.explicitModuleVisibility = {
    capturedThroughInjectedService: true,
    missingImportDeniedAtRuntime: true,
  };
  cli(
    'scaffold-controller',
    localCli,
    ['g', 'controller', 'widgets', '--offline', '--check'],
    app,
  );
  assert.doesNotMatch(
    await readFile(
      join(app, 'src/modules/widgets/widgets.controller.ts'),
      'utf8',
    ),
    /@(Get|Post|Put|Patch|Delete)\(/,
  );
  assert.equal(await readFile(customPath, 'utf8'), custom);
  facts.customization = {
    customModulePreserved: true,
    privateEnvPreserved: true,
    customScriptPreserved: true,
    repeatedAddChanged: 0,
    namedControllerUnexposed: true,
  };
  success = true;
} finally {
  if (child?.pid && child.exitCode === null) child.kill('SIGTERM');
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(
      { success, workspace, records, facts, independentFromRepository: true },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  if (success) await rm(workspace, { recursive: true });
  else
    process.stderr.write(
      `Preserved task-owned failed fixture at ${workspace}; see sanitized evidence.\n`,
    );
}

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Module, type InjectionToken, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import mongoose from 'mongoose';
import ts from 'typescript';
import type { ProjectConfig, RenderedFile } from '../src/contracts.js';
import type { BootstrapBinding } from '../templates/runtime/common/src/core/bootstrap/bootstrap-bindings.ts';
import { linkGeneratedDependencies } from './generated-dependencies.ts';

type Renderer = typeof import('../src/recipes/render-mail.js');
let fixture: string;
let renderer: Renderer;
const tsc = resolve('node_modules/typescript/bin/tsc');
function compile(config: string): void {
  const result = spawnSync(process.execPath, [tsc, '-p', config], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
before(async () => {
  await mkdir(resolve('var'), { recursive: true });
  fixture = await mkdtemp(resolve('var/cli-mail-integration-'));
  const root = fixture + '/generator';
  await mkdir(root, { recursive: true });
  await symlink(resolve('templates'), root + '/templates', 'dir');
  await writeFile(root + '/package.json', JSON.stringify({ type: 'module' }));
  await writeFile(
    root + '/tsconfig.json',
    JSON.stringify({
      extends: resolve('tsconfig.json'),
      compilerOptions: {
        outDir: root + '/dist',
        rootDir: resolve('src'),
        declaration: false,
        sourceMap: false,
      },
      include: [resolve('src/recipes/render-mail.ts')],
      exclude: [],
    }),
  );
  compile(root + '/tsconfig.json');
  renderer = (await import(
    pathToFileURL(root + '/dist/recipes/render-mail.js').href
  )) as Renderer;
});
after(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true });
});
function config(
  mail?: 'capture' | 'smtp',
  database?: 'mongodb' | 'postgres',
  reliable = false,
  auth?: 'local' | 'firebase',
  delivery = 'provider',
): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'mail-render-api', packageManager: 'npm' },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      ...(mail
        ? {
            mail: {
              recipe: 'mail.' + mail,
              options: { reliableActions: reliable },
            },
          }
        : {}),
      ...(database
        ? { database: { recipe: 'database.' + database, options: {} } }
        : {}),
      ...(auth
        ? {
            auth: {
              recipe: 'auth.' + auth,
              options: auth === 'firebase' ? { actionDelivery: delivery } : {},
            },
          }
        : {}),
    },
  };
}
function content(files: RenderedFile[], path: string): string {
  const file = files.find((f) => f.path === path);
  assert.ok(file, path);
  return file.content;
}
async function render(config: ProjectConfig): Promise<RenderedFile[]> {
  const files = [
    ...(await renderer.mailFiles(config)),
    ...(await renderer.firebaseMailFiles(config)),
  ];
  assert.equal(
    new Set(files.map((f) => f.path)).size,
    files.length,
    'duplicate emitted path',
  );
  return files;
}
test('deterministic immediate capture/SMTP closure remains DB-free and preserves stable helpers', async () => {
  for (const mail of ['capture', 'smtp'] as const) {
    const selected = config(mail),
      files = await render(selected);
    assert.deepEqual(files, await render(selected));
    const text = files.map((f) => f.content).join('\n');
    assert.ok(!text.includes('core/database'));
    assert.ok(!text.includes('MailIntent'));
    assert.ok(!text.includes('firebase-admin'));
    assert.ok(!text.includes('initializeMail'));
    assert.ok(!files.some((f) => f.path === 'src/drain-mail.ts'));
    const module = content(files, 'src/modules/mail/mail.module.ts');
    assert.ok(module.includes('createMailRuntime'));
    assert.ok(module.includes('createMailSender'));
    assert.ok(module.includes('intents:undefined'));
    assert.ok(module.includes('exports:[MailService]'));
    assert.equal(module.includes('createTestMailCapture'), mail === 'capture');
    assert.equal(
      files.some((f) => f.path.endsWith('/smtp-mail.service.ts')),
      mail === 'smtp',
    );
  }
});
test('local immediate auth gets only the neutral participant while reliable output is selected-native', async () => {
  const local = await render(config('capture', 'mongodb', false, 'local'));
  assert.ok(local.some((f) => f.path === 'src/core/mail/action-delivery.ts'));
  assert.ok(!local.some((f) => f.path.endsWith('mail-intent.service.ts')));
  for (const database of ['mongodb', 'postgres'] as const) {
    const files = await render(config('smtp', database, true));
    assert.ok(files.some((f) => f.path === 'src/drain-mail.ts'));
    assert.ok(
      content(files, 'src/drain-mail.ts').includes(
        'openDatabase(config,false)',
      ),
    );
    assert.ok(!content(files, 'src/drain-mail.ts').includes('initializeMail'));
    const source = content(files, 'src/modules/mail/mail-intent-store.ts');
    assert.ok(
      source.includes(
        database === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase',
      ),
    );
    assert.ok(
      !source.includes(
        database === 'mongodb' ? 'PostgresDatabase' : 'MongoDatabase',
      ),
    );
    const module = content(files, 'src/modules/mail/mail.module.ts');
    assert.ok(module.includes('config.mailDelivery'));
    assert.ok(module.includes('intentsBinding.bind(intents)'));
    assert.ok(files.some((f) => f.path.endsWith('/initialize-mail.ts')));
  }
});
test('Firebase provider and application assets are separate and complete without duplicate mail paths', async () => {
  for (const mail of [undefined, 'capture'] as const) {
    const files = await render(config(mail, 'mongodb', false, 'firebase'));
    assert.ok(
      files.some((f) => f.path === 'clients/mail-firebase-actions.mjs'),
    );
    assert.ok(files.some((f) => f.path.endsWith('/firebase-action-policy.ts')));
    assert.ok(files.some((f) => f.path.endsWith('/render-message.ts')));
    assert.ok(
      !files.some((f) => f.path.endsWith('/firebase-action-links.service.ts')),
    );
    if (!mail)
      assert.ok(
        !files.some((f) =>
          /\/(capture-mail|smtp-mail|mail|mail-intent)\.service\.ts$/.test(
            f.path,
          ),
        ),
      );
  }
  const files = await render(
    config('capture', 'postgres', true, 'firebase', 'application'),
  );
  assert.ok(
    files.some((f) => f.path.endsWith('/firebase-action-links.service.ts')),
  );
  await assert.rejects(
    renderer.mailFiles(config('capture', undefined, true)),
    /RELIABLE_MAIL_REQUIRES_DATABASE/,
  );
  await assert.rejects(
    renderer.firebaseMailFiles(
      config(undefined, 'postgres', false, 'firebase', 'application'),
    ),
    /REQUIRE_RELIABLE_MAIL/,
  );
  const invalid = config('smtp');
  invalid.capabilities.mail!.options.reliableActions = 'yes';
  await assert.rejects(renderer.mailFiles(invalid), /INVALID_MAIL_OPTIONS/);
});

const profiles = [
  { name: 'capture-only', mail: 'capture' },
  { name: 'smtp-only', mail: 'smtp' },
  {
    name: 'local-immediate',
    mail: 'capture',
    database: 'mongodb',
    auth: 'local',
  },
  {
    name: 'reliable-mongo',
    mail: 'capture',
    database: 'mongodb',
    reliable: true,
  },
  {
    name: 'reliable-postgres',
    mail: 'smtp',
    database: 'postgres',
    reliable: true,
  },
  { name: 'firebase-provider', database: 'mongodb', auth: 'firebase' },
  {
    name: 'firebase-application-mongo',
    mail: 'capture',
    database: 'mongodb',
    auth: 'firebase',
    reliable: true,
    delivery: 'application',
  },
  {
    name: 'firebase-application-postgres',
    mail: 'smtp',
    database: 'postgres',
    auth: 'firebase',
    reliable: true,
    delivery: 'application',
  },
] as const;
type Profile = (typeof profiles)[number];
type Sender = { submit(message: object): Promise<{ status: string }> };
type Runtime = {
  sender: Sender;
  intents: undefined | { prepare(message: object, expiresAt: number): object };
  bindings: readonly BootstrapBinding[];
  close(): Promise<void>;
};
type RuntimeModule = {
  createMailRuntime(
    config: object,
    database?: unknown,
    dependencies?: { sender?: Sender },
  ): Runtime;
  createMailSender(config: object): Sender;
  MailModule: Type<unknown>;
  createTestMailCapture?(maximum?: number): {
    sender: Sender;
    inspect(): unknown[];
  };
};
const instances = new Map<string, { module: RuntimeModule; config: object }>();
for (const profile of profiles)
  test(`strict emitted mail compilation and Nest exports ${profile.name}`, async () => {
    const p = profile as Profile & {
      mail?: 'capture' | 'smtp';
      database?: 'mongodb' | 'postgres';
      auth?: 'local' | 'firebase';
      reliable?: boolean;
      delivery?: string;
    };
    const selected = config(p.mail, p.database, p.reliable, p.auth, p.delivery),
      files = await render(selected);
    const root = fixture + '/profiles/' + profile.name;
    await mkdir(root + '/src/core/errors', { recursive: true });
    await cp(
      'templates/runtime/common/src/core/errors/application-error.ts',
      root + '/src/core/errors/application-error.ts',
    );
    await cp(
      'templates/runtime/common/src/core/bootstrap',
      root + '/src/core/bootstrap',
      { recursive: true },
    );
    await linkGeneratedDependencies(root);
    await writeFile(root + '/package.json', JSON.stringify({ type: 'module' }));
    if (p.database)
      await cp(
        `templates/runtime/${p.database}/src/core/database`,
        root + '/src/core/database',
        { recursive: true },
      );
    const mailType =
      p.mail === 'capture'
        ? "{driver:'capture';from:string;maxCaptured:number}"
        : "{driver:'smtp';from:string;host:string;port:number;secure:boolean;user?:string;password?:string;timeoutMs:number;maxConcurrency:number}";
    await mkdir(root + '/src/core/config', { recursive: true });
    await writeFile(
      root + '/src/core/config/app-config.ts',
      `export type AppConfig={environment:'development'|'test'|'production';${p.mail ? 'mail:' + mailType + ';' : ''}${p.database ? `database:{url:string};` : ''}${p.reliable ? 'mailDelivery:{activeKeyId:string;keys:Record<string,string>;maxAttempts:number;leaseMs:number;maxLifetimeMs:number};' : ''}};`,
    );
    if (p.reliable)
      await writeFile(
        root + '/src/core/config/load-config.ts',
        "import type {AppConfig} from './app-config.js';export function loadSelectedEnvFile():void{}export function loadConfig():AppConfig{throw new Error('FIXTURE_CONFIG_NOT_FOR_DATABASE_EXECUTION');}",
      );
    for (const item of files) {
      await mkdir(dirname(root + '/' + item.path), { recursive: true });
      await writeFile(root + '/' + item.path, item.content);
    }
    await writeFile(
      root + '/tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'dist',
          rootDir: 'src',
          noUncheckedIndexedAccess: true,
          types: ['node'],
        },
        include: ['src/**/*.ts'],
        exclude: p.reliable ? [] : ['src/core/database/database.ts'],
      }),
    );
    compile(root + '/tsconfig.json');
    // SDKs and native database classes compile, but no actual DB or external provider is opened.
    if (!p.mail) return;
    const module = (await import(
      pathToFileURL(root + '/dist/modules/mail/mail.module.js').href
    )) as RuntimeModule;
    const settings = {
      environment: 'test',
      mail:
        p.mail === 'capture'
          ? { driver: 'capture', from: 'from@example.invalid', maxCaptured: 2 }
          : {
              driver: 'smtp',
              from: 'from@example.invalid',
              host: '127.0.0.1',
              port: 2525,
              secure: false,
              timeoutMs: 100,
              maxConcurrency: 1,
            },
      ...(p.reliable
        ? {
            mailDelivery: {
              activeKeyId: 'fixture',
              keys: { fixture: Buffer.alloc(32, 23).toString('base64') },
              maxAttempts: 2,
              leaseMs: 1000,
              maxLifetimeMs: 60000,
            },
          }
        : {}),
    };
    let database: unknown, connection: { close(): Promise<void> } | undefined;
    if (p.reliable) {
      assert.throws(
        () => module.createMailRuntime(settings),
        /MAIL_DATABASE_REQUIRED/,
      );
      if (p.database === 'mongodb') {
        connection = mongoose.createConnection();
        database = { connection }; // Disconnected native model constructor, no URL/network.
      } else database = {}; // PostgreSQL store constructor only records this controlled handle.
    }
    const runtime = module.createMailRuntime(settings, database);
    try {
      assert.equal(runtime.intents !== undefined, !!p.reliable);
      const { MailService } = (await import(
        pathToFileURL(root + '/dist/modules/mail/mail.service.js').href
      )) as { MailService: Type<unknown> };
      const inject: InjectionToken[] = [MailService];
      if (p.reliable) {
        const { MailIntentService } = (await import(
          pathToFileURL(root + '/dist/modules/mail/mail-intent.service.js').href
        )) as { MailIntentService: Type<unknown> };
        inject.push(MailIntentService);
      }
      class MailConsumerModule {}
      Module({
        imports: [module.MailModule],
        providers: [
          {
            provide: 'MAIL_CONSUMER',
            inject,
            useFactory: (...services: unknown[]) => services,
          },
        ],
      })(MailConsumerModule);
      const { withBootstrapBindings } = (await import(
        pathToFileURL(root + '/dist/core/bootstrap/bootstrap-bindings.js').href
      )) as Pick<
        typeof import('../templates/runtime/common/src/core/bootstrap/bootstrap-bindings.ts'),
        'withBootstrapBindings'
      >;
      const context = await withBootstrapBindings(runtime.bindings, () =>
        NestFactory.createApplicationContext(MailConsumerModule, {
          logger: false,
          abortOnError: false,
        }),
      );
      try {
        assert.deepEqual(context.get('MAIL_CONSUMER'), [
          runtime.sender,
          ...(p.reliable ? [runtime.intents] : []),
        ]);
        assert.equal(context.get(MailService), runtime.sender);
        if (p.reliable) {
          const { MailIntentService } = (await import(
            pathToFileURL(root + '/dist/modules/mail/mail-intent.service.js')
              .href
          )) as { MailIntentService: Type<unknown> };
          assert.equal(context.get(MailIntentService), runtime.intents);
        }
      } finally {
        await context.close();
      }
      if (p.mail === 'capture') {
        assert.equal(
          (
            await runtime.sender.submit({
              operationId: 'runtime-1',
              purpose: 'notification',
              to: 'to@example.invalid',
              subject: 'Hello',
              text: 'Private body',
            })
          ).status,
          'captured',
        );
        assert.throws(() => module.createTestMailCapture?.(0));
        assert.throws(
          () =>
            module.createMailSender({ ...settings, environment: 'production' }),
          /UNSAFE_PRODUCTION_CAPTURE/,
        );
      }
    } finally {
      await runtime.close();
      await runtime.close();
      await connection?.close();
    }
    let calls = 0,
      closed = 0;
    const injected = {
      async submit(_message: object) {
        calls++;
        return { status: 'captured' };
      },
      close() {
        closed++;
      },
    };
    const injectedRuntime = module.createMailRuntime(settings, database, {
      sender: injected,
    });
    assert.equal(injectedRuntime.sender, injected);
    assert.equal(injectedRuntime.intents !== undefined, !!p.reliable);
    await injectedRuntime.sender.submit({});
    await injectedRuntime.close();
    await injectedRuntime.close();
    assert.equal(calls, 1);
    assert.equal(closed, 0, 'injected sender stays caller-owned');
    if (p.mail === 'capture')
      assert.throws(
        () =>
          module.createMailRuntime(
            { ...settings, environment: 'production' },
            database,
            { sender: injected },
          ),
        /UNSAFE_PRODUCTION_CAPTURE/,
      );
    instances.set(profile.name, { module, config: settings });
  });

test('generated SMTP runtime closes its sender without opening a network connection', async () => {
  const fixture = instances.get('smtp-only');
  assert.ok(fixture);
  const runtime = fixture.module.createMailRuntime(fixture.config);
  await runtime.close();
  assert.equal(
    (
      await runtime.sender.submit({
        operationId: 'closed-1',
        purpose: 'notification',
        to: 'to@example.invalid',
        subject: 'Hello',
        text: 'Hello',
      })
    ).status,
    'unavailable',
  );
});

test('bounded drain command uses controlled peers, safe outcomes and finally cleanup', async () => {
  const files = await renderer.mailFiles(config('smtp', 'postgres', true));
  const source = content(files, 'src/drain-mail.ts'),
    root = fixture + '/drain-command';
  await mkdir(root + '/core/config', { recursive: true });
  await mkdir(root + '/core/database', { recursive: true });
  await mkdir(root + '/modules/mail', { recursive: true });
  await writeFile(root + '/package.json', JSON.stringify({ type: 'module' }));
  await writeFile(
    root + '/drain-mail.js',
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
  await linkGeneratedDependencies(root);
  const trace =
    "import {appendFileSync} from 'node:fs';const record=(value)=>appendFileSync(process.env.MAIL_FIXTURE_TRACE,value+'\\n');";
  await writeFile(
    root + '/core/config/load-config.js',
    trace +
      "export function loadSelectedEnvFile(){record('env');}export function loadConfig(){record('config');if(process.env.MAIL_FIXTURE_FAIL==='config')throw new Error('PRIVATE_KEY_CONFIG');return {};}",
  );
  await writeFile(
    root + '/core/database/database.js',
    trace +
      "export async function openDatabase(config,initialized){record('open:'+initialized);if(process.env.MAIL_FIXTURE_FAIL==='open')throw new Error('PRIVATE_DATABASE_URL');return {async close(){record('database.close');}};}",
  );
  await writeFile(
    root + '/modules/mail/mail.module.js',
    trace +
      "export function createMailRuntime(){record('runtime');return {intents:{async drain(limit){record('drain:'+limit);if(process.env.MAIL_FIXTURE_FAIL==='drain')throw new Error('PRIVATE_ACTION_LINK');return {processed:limit};}},async close(){record('mail.close');if(process.env.MAIL_FIXTURE_FAIL==='close')throw new Error('PRIVATE_SMTP_PASSWORD');}};}",
  );
  for (const [args, fail, expected] of [
    [['--limit', '7'], '', 0],
    [['--limit', '101'], '', 1],
    [['--limit', '0'], '', 1],
    [['--limit', '1', 'extra'], '', 1],
    [[], 'config', 1],
    [[], 'open', 1],
    [[], 'drain', 1],
    [[], 'close', 1],
  ] as const) {
    const path = root + '/trace.txt';
    await writeFile(path, '');
    const result = spawnSync(
      process.execPath,
      [root + '/drain-mail.js', ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          MAIL_FIXTURE_TRACE: path,
          MAIL_FIXTURE_FAIL: fail,
        },
      },
    );
    assert.equal(result.status, expected, result.stdout + result.stderr);
    assert.ok(!(result.stdout + result.stderr).includes('PRIVATE_'));
    if (expected === 0) {
      assert.equal(result.stdout, '{"processed":7}\n');
      assert.equal(result.stderr, '');
    } else {
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'MAIL_DRAIN_FAILED\n');
    }
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    if (['drain', 'close'].includes(fail)) {
      assert.ok(lines.includes('mail.close'));
      assert.ok(lines.includes('database.close'));
    }
    if (args.length && expected === 1) assert.deepEqual(lines, ['']);
    if (expected === 0) assert.ok(lines.includes('open:false'));
  }
});

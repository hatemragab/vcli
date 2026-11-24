import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { ProjectConfig } from '../src/contracts.js';
import { configuration } from '../dist/recipes/render-config.js';
import { recipes } from '../dist/recipes/catalog.js';
import { serviceFiles } from '../dist/recipes/render-services.js';
import { validateSelection } from '../dist/recipes/selection.js';

function config(
  ids: string[],
  options: Record<string, Record<string, unknown>> = {},
): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'config-api', packageManager: 'npm' },
    capabilities: Object.fromEntries(
      ids.map((id) => {
        const recipe = recipes.find((item) => item.id === id)!;
        return [
          recipe.family,
          {
            recipe: id,
            options: recipe.validateOptions(options[recipe.family] ?? {}),
          },
        ];
      }),
    ),
  };
}
async function withConfiguration(
  choices: ProjectConfig,
  work: (
    load: (env: NodeJS.ProcessEnv) => Record<string, unknown>,
    source: string,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-config-'));
  try {
    await symlink(
      resolve('node_modules'),
      join(directory, 'node_modules'),
      'dir',
    );
    await writeFile(
      join(directory, 'package.json'),
      '{"type":"module","private":true}',
    );
    const files = configuration(choices).files.filter((file) =>
      file.path.endsWith('.ts'),
    );
    files.push({
      path: 'src/core/errors/application-error.ts',
      content: await readFile(
        'templates/runtime/common/src/core/errors/application-error.ts',
        'utf8',
      ),
      ownership: 'scaffold',
    });
    for (const file of files) {
      const path = join(directory, file.path.replace(/\.ts$/, '.js'));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        ts.transpileModule(file.content, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2023,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      );
    }
    const module: {
      loadConfig: (env: NodeJS.ProcessEnv) => Record<string, unknown>;
    } = await import(
      pathToFileURL(join(directory, 'src/core/config/load-config.js')).href
    );
    await work(
      module.loadConfig,
      files.find((file) => file.path.endsWith('load-config.ts'))!.content,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const database = 'postgresql://fixture:private@127.0.0.1:5432/test';
const redis = 'redis://127.0.0.1:6379';
function localEnv(): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: database,
    REDIS_URL: redis,
    JWT_ACTIVE_KID: 'current',
    JWT_KEYS_JSON: JSON.stringify([
      { id: 'current', key: randomBytes(32).toString('base64url') },
    ]),
  };
}
const local = config([
  'foundation.nest',
  'database.postgres',
  'auth.local',
  'mail.capture',
]);

test('fresh MongoDB development defaults isolate databases by project', () => {
  const choices = config(['foundation.nest', 'database.mongodb']);
  const defaults = (name: string) =>
    configuration({ ...choices, project: { ...choices.project, name } });
  const sample = defaults('my-new-api-2');
  const mongo = sample.developmentDefaults.DATABASE_URL!;
  assert.equal(
    mongo,
    'mongodb://127.0.0.1:27017/my-new-api-2-development?replicaSet=rs0&directConnection=true',
  );
  assert.deepEqual(
    sample.fields.find(({ key }) => key === 'DATABASE_URL'),
    {
      key: 'DATABASE_URL',
      required: true,
      secret: true,
    },
  );
  const names = ['wiki-api', 'wiki.api', 'wiki_api', 'a'.repeat(64)].map(
    (name) =>
      new URL(defaults(name).developmentDefaults.DATABASE_URL!).pathname.slice(
        1,
      ),
  );
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9-]{1,63}$/);
  const services = serviceFiles(
    { ...choices, project: { ...choices.project, name: 'my-new-api-2' } },
    sample.fields,
  );
  assert.ok(
    services
      .find(({ path }) => path === 'ops/local/README.md')!
      .content.includes(mongo.replace(':27017/', ':<selected-port>/')),
  );
});

test('local selected configuration decodes a rotating key ring and rejects unsafe selection without values', async () => {
  await withConfiguration(local, async (load, source) => {
    const env = localEnv();
    const actual = load(env);
    assert.equal(source.includes('JWT_SECRET'), false);
    assert.equal(JSON.stringify(actual).includes('firebaseProjectId'), false);
    const auth = actual.auth as {
      rateLimitRedisUrl: string;
      rateLimitNamespace: string;
      jwtPolicy: {
        keys: { id: string; key: Uint8Array }[];
        activeSigningKeyId: string;
      };
    };
    assert.equal(auth.rateLimitRedisUrl, redis);
    assert.equal(auth.rateLimitNamespace, 'config-api:development');
    assert.equal(auth.jwtPolicy.keys[0]!.key.byteLength, 32);
    assert.equal(auth.jwtPolicy.activeSigningKeyId, 'current');
    for (const change of [
      { JWT_KEYS_JSON: 'PRIVATE_SENTINEL' },
      { JWT_ACTIVE_KID: 'missing' },
      { JWT_KEYS_JSON: '[{"id":"PRIVATE_SENTINEL","key":"PRIVATE_SENTINEL"}]' },
      { ACCESS_TTL_SECONDS: '901' },
    ])
      assert.throws(
        () => load({ ...env, ...change }),
        (error) => !String(error).includes('PRIVATE_SENTINEL'),
      );
    const key = randomBytes(32).toString('base64url');
    assert.throws(() =>
      load({
        ...env,
        JWT_KEYS_JSON: JSON.stringify([
          { id: 'current', key },
          { id: 'current', key: randomBytes(32).toString('base64url') },
        ]),
      }),
    );
    assert.throws(() =>
      load({
        ...env,
        JWT_KEYS_JSON: JSON.stringify([
          { id: 'current', key },
          { id: 'next', key },
        ]),
      }),
    );
  });
});

test('reliable SMTP configuration bounds key material, lease and total delivery timeout', async () => {
  const choices = config(
    ['foundation.nest', 'database.postgres', 'mail.smtp'],
    { mail: { reliableActions: true } },
  );
  await withConfiguration(choices, async (load) => {
    const env = {
      DATABASE_URL: database,
      SMTP_HOST: '127.0.0.1',
      MAIL_DELIVERY_KEY_ID: 'active',
      MAIL_DELIVERY_KEYS_JSON: JSON.stringify({
        active: randomBytes(32).toString('base64'),
      }),
    };
    const actual = load(env);
    assert.ok(actual.mailDelivery);
    for (const change of [
      { MAIL_DELIVERY_KEY_ID: 'missing' },
      { MAIL_DELIVERY_KEYS_JSON: 'PRIVATE_SENTINEL' },
      { MAIL_DELIVERY_LEASE_MS: '1000', SMTP_TIMEOUT_MS: '1000' },
      { SMTP_TIMEOUT_MS: '60001' },
    ])
      assert.throws(
        () => load({ ...env, ...change }),
        (error) => !String(error).includes('PRIVATE_SENTINEL'),
      );
  });
});

test('Firebase provider/no-mail needs no local secrets; application delivery checks server continue policy', async () => {
  const provider = config([
    'foundation.nest',
    'database.postgres',
    'auth.firebase',
  ]);
  await withConfiguration(provider, async (load, source) => {
    const actual = load({
      DATABASE_URL: database,
      REDIS_URL: redis,
      FIREBASE_PROJECT_ID: 'fixture-project',
    });
    assert.equal('mail' in actual, false);
    assert.equal('firebaseActions' in actual, false);
    assert.equal(/JWT_|SMTP_|MAIL_DELIVERY_/.test(source), false);
  });
  const application = config(
    ['foundation.nest', 'database.postgres', 'auth.firebase', 'mail.capture'],
    {
      auth: { actionDelivery: 'application' },
      mail: { reliableActions: true },
    },
  );
  await withConfiguration(application, async (load) => {
    const env = {
      DATABASE_URL: database,
      REDIS_URL: redis,
      FIREBASE_PROJECT_ID: 'fixture-project',
      MAIL_DELIVERY_KEY_ID: 'active',
      MAIL_DELIVERY_KEYS_JSON: JSON.stringify({
        active: randomBytes(32).toString('base64'),
      }),
      FIREBASE_ACTION_CONTINUE_ORIGINS: '["http://127.0.0.1:3100"]',
      FIREBASE_ACTION_CONTINUE_URL: 'http://127.0.0.1:3100/auth/action',
    };
    assert.ok(load(env).firebaseActions);
    for (const change of [
      { FIREBASE_ACTION_CONTINUE_URL: 'https://foreign.example/auth/action' },
      { FIREBASE_ACTION_CONTINUE_ORIGINS: '["http://foreign.example"]' },
      { FIREBASE_ACTION_LINK_DOMAIN: 'project.web.app' },
      { FIREBASE_ACTION_HANDLE_CODE_IN_APP: 'true' },
      { FIREBASE_ACTION_ANDROID_MINIMUM_VERSION: 'PRIVATE_SENTINEL' },
    ])
      assert.throws(
        () => load({ ...env, ...change }),
        (error) => !String(error).includes('PRIVATE_SENTINEL'),
      );
  });
});

test('authentication requires a private Redis URL and namespaces production counters', async () => {
  const provider = config([
    'foundation.nest',
    'database.postgres',
    'auth.firebase',
  ]);
  await withConfiguration(provider, async (load) => {
    const env = {
      NODE_ENV: 'production',
      DATABASE_URL: database,
      FIREBASE_PROJECT_ID: 'fixture-project',
    };
    assert.throws(() => load({ ...env, REDIS_URL: undefined }), /REDIS_URL/);
    assert.throws(
      () => load({ ...env, REDIS_URL: 'https://PRIVATE_SENTINEL' }),
      (error) =>
        String(error).includes('REDIS_URL') &&
        !String(error).includes('PRIVATE_SENTINEL'),
    );
    const redisUrl = 'rediss://redis.example.invalid:6380';
    const auth = load({ ...env, REDIS_URL: redisUrl }).auth as {
      rateLimitRedisUrl: string;
      rateLimitNamespace: string;
    };
    assert.equal(auth.rateLimitRedisUrl, redisUrl);
    assert.equal(auth.rateLimitNamespace, 'config-api:production');
  });
  assert.ok(
    !configuration(config(['foundation.nest'])).keys.includes('REDIS_URL'),
  );
});

test('unsupported transfer/source combinations fail before any rendering or writes', () => {
  for (const choices of [
    config(
      [
        'foundation.nest',
        'database.postgres',
        'auth.local',
        'mail.capture',
        'storage.local',
        'media.private',
      ],
      { media: { modes: ['multipart'] } },
    ),
    config(
      [
        'foundation.nest',
        'database.postgres',
        'auth.local',
        'mail.capture',
        'storage.r2',
        'media.private',
      ],
      { media: { modes: ['presigned'] } },
    ),
    config(['foundation.nest', 'diagnostics.local'], {
      diagnostics: { sources: ['application', 'database'] },
    }),
  ])
    assert.throws(() =>
      validateSelection(
        choices,
        Object.values(choices.capabilities).map((choice) =>
          recipes.find((recipe) => recipe.id === choice.recipe)!,
        ),
      ),
    );
  assert.throws(() =>
    recipes
      .find((recipe) => recipe.id === 'diagnostics.local')!
      .validateOptions({ sources: ['tests'], testCapture: true }),
  );
});

test('numeric bounds stay on integer fields and ignore nested array limits', () => {
  const fields = configuration(local).fields;
  const jwt = fields.find((field) => field.key === 'JWT_KEYS_JSON');
  const host = fields.find((field) => field.key === 'HOST');
  const port = fields.find((field) => field.key === 'PORT');
  assert.equal(jwt?.minimum, undefined);
  assert.equal(jwt?.maximum, undefined);
  assert.equal(host?.minimum, undefined);
  assert.equal(port?.minimum, 1);
  assert.equal(port?.maximum, 65535);
  const evidence = configuration(
    config(['foundation.nest', 'diagnostics.local']),
  ).fields.find((field) => field.key === 'EVIDENCE_MAX_BYTES');
  assert.equal(evidence?.minimum, 512);
  assert.equal(evidence?.maximum, 10485760);
});

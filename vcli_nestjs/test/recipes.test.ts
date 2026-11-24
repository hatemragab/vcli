import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import type { ProjectConfig, RenderedProject } from '../src/contracts.js';
import { recipeCatalog, renderScaffold } from '../dist/recipes/index.js';

function config(...ids: string[]): ProjectConfig {
  const capabilities: ProjectConfig['capabilities'] = {};
  for (const id of ['foundation.nest', ...ids]) {
    const recipe = recipeCatalog.recipes.find((r) => r.id === id)!;
    assert.ok(recipe, id);
    capabilities[recipe.family] = { recipe: id, options: {} };
  }
  return {
    schemaVersion: 1,
    project: { name: 'sample-api', packageManager: 'npm' },
    capabilities,
  };
}
function render(input: ProjectConfig): Promise<RenderedProject> {
  return recipeCatalog.render(
    input,
    recipeCatalog.recipes.filter(
      (r) => input.capabilities[r.family]?.recipe === r.id,
    ),
  );
}
function contents(project: RenderedProject, path: string): string {
  const source = project.files.find((f) => f.path === path);
  assert.ok(source, path);
  return source.content;
}
function packages(project: RenderedProject): Record<string, string> {
  return (
    JSON.parse(contents(project, 'package.json')) as {
      dependencies: Record<string, string>;
    }
  ).dependencies;
}
function assertImports(project: RenderedProject): void {
  const paths = new Set(project.files.map((f) => f.path));
  const dependencies = packages(project);
  for (const file of project.files.filter(
    (file) => file.path.startsWith('src/') && file.path.endsWith('.ts'),
  )) {
    const source = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    const parsed = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.NodeNext,
        experimentalDecorators: true,
      },
    });
    const errors = (parsed.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    );
    assert.equal(
      errors.length,
      0,
      file.path +
        ': ' +
        errors
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '))
          .join(', '),
    );
    source.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        return;
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('.')) {
        const target = posix
          .normalize(posix.join(posix.dirname(file.path), specifier))
          .replace(/\.js$/, '.ts');
        assert.ok(paths.has(target), `${file.path} imports absent ${target}`);
      } else if (!specifier.startsWith('node:')) {
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0]!;
        assert.ok(dependencies[name], `${file.path} needs undeclared ${name}`);
      }
    });
  }
}

test('an uninitialized database reports the schema release instead of a connectivity failure', async () => {
  const selected = config('database.mongodb', 'auth.local');
  selected.capabilities.auth!.options = { identifier: 'username' };
  const project = await render(selected);
  const app = contents(project, 'src/create-app.ts');
  assert.match(app, /DATABASE_INITIALIZATION_REQUIRED/);
  assert.match(app, /releaseMissing\s*\?\s*'SCHEMA_RELEASE_REQUIRED'/);
  assert.match(
    app,
    /const reported = releaseMissing \? 'schema' : startupStage/,
  );
  assert.match(app, /stage: reported/);
  assert.match(
    contents(project, 'src/core/database/mongo-database.ts'),
    /new ApplicationError\(\s*'DATABASE_INITIALIZATION_REQUIRED',\s*500,?\s*\)/,
  );
  assert.doesNotMatch(
    contents(project, 'src/core/database/mongo-database.ts'),
    /SCHEMA_RELEASE_REQUIRED/,
  );
});

test('foundation is deterministic, complete and independent of every optional SDK', async () => {
  const selected = config();
  const first = await render(selected);
  assert.deepEqual(first, await render(selected));
  for (const name of [
    'mongoose',
    'pg',
    'drizzle-orm',
    'argon2',
    'jose',
    'firebase-admin',
    'nodemailer',
    'ws',
    'socket.io',
    '@aws-sdk/client-s3',
    '@modelcontextprotocol/sdk',
  ])
    assert.equal(packages(first)[name], undefined, name);
  assert.equal(
    first.files.some((f) =>
      /src\/modules\/(identity|accounts|media|mail|push|storage|realtime)/.test(
        f.path,
      ),
    ),
    false,
  );
  assert.match(
    contents(first, 'src/generated/vcli-app.module.ts'),
    /imports:\s*\[[^\]]*\bHealthModule\b/,
  );
  assert.match(contents(first, 'src/create-app.ts'), /markStopping/);
  assert.equal(
    first.files.find((f) => f.path === 'src/app.custom.module.ts')?.ownership,
    'scaffold',
  );
  assert.equal(
    first.files.find((f) => f.path === 'src/generated/vcli-app.module.ts')
      ?.ownership,
    'managed',
  );
  assert.match(contents(first, 'package.json'), /file:tools\/vcli/);
  const guidance = contents(first, 'AGENTS.md');
  for (const command of [
    'vcli inspect --json',
    'vcli explain src/app.custom.module.ts',
    'vcli catalog --verbose',
    'vcli add <recipe> --dry-run',
    'vcli g feature invoices --dry-run',
    'vcli check',
  ])
    assert.ok(guidance.includes(command), command);
  assert.doesNotMatch(guidance, /BaseRepository|custom-migrations\.ts/);
  assert.ok(
    guidance.indexOf('## Project-specific rules and decisions') >
      guidance.indexOf('<!-- vcli:managed:end -->'),
  );
  assertImports(first);
});

test('selection ordering and Firebase method ordering do not change desired output', async () => {
  const first = config(
    'database.mongodb',
    'auth.firebase',
    'diagnostics.local',
  );
  first.capabilities.auth!.options = { methods: ['apple', 'email-password'] };
  const second = {
    ...first,
    capabilities: Object.fromEntries(
      Object.entries(first.capabilities).reverse(),
    ),
  };
  second.capabilities.auth = {
    recipe: 'auth.firebase',
    options: { methods: ['email-password', 'apple'] },
  };
  assert.deepEqual(await render(first), await render(second));
});

test('capture add introduces no SMTP SDK, public inspection or owner rewrites', async () => {
  const before = await render(config());
  const after = await render(config('mail.capture'));
  assert.equal(packages(after).nodemailer, undefined);
  assert.match(
    contents(after, 'src/modules/mail/mail.module.ts'),
    /UNSAFE_PRODUCTION_CAPTURE/,
  );
  assert.equal(
    after.files.some((f) => f.path.endsWith('mail.controller.ts')),
    false,
  );
  for (const existing of before.files.filter((f) => f.ownership === 'scaffold'))
    assert.equal(contents(after, existing.path), existing.content);
  assertImports(after);
});

for (const database of ['mongodb', 'postgres'])
  for (const auth of ['local', 'firebase']) {
    test(`selected ${auth}/${database} has actual isolated source and complete imports`, async () => {
      const project = await render(
        config(
          `database.${database}`,
          `auth.${auth}`,
          ...(auth === 'local' ? ['mail.capture'] : []),
        ),
      );
      const deps = packages(project);
      assert.equal(!!deps.mongoose, database === 'mongodb');
      assert.equal(!!deps.pg, database === 'postgres');
      assert.equal(!!deps['drizzle-orm'], database === 'postgres');
      assert.equal(!!deps.argon2, auth === 'local');
      assert.equal(!!deps.jose, auth === 'local');
      assert.equal(!!deps['firebase-admin'], auth === 'firebase');
      assert.equal(deps.nodemailer, undefined);
      assert.equal(
        project.files.some((f) => /firebase-token-verifier/.test(f.path)),
        auth === 'firebase',
      );
      assert.equal(
        project.files.some((f) => /argon-passwords/.test(f.path)),
        auth === 'local',
      );
      assert.match(
        contents(project, 'src/modules/identity/identity.module.ts'),
        /@Module\(\{\s*imports:\s*\[[^\]]*\bDatabaseModule\b/,
      );
      assert.match(
        contents(project, 'src/create-app.ts'),
        /bindDatabase\(db\)/,
      );
      assert.equal(
        project.files.find(
          (f) => f.path === 'src/modules/accounts/account.service.ts',
        )?.ownership,
        'scaffold',
      );
      assert.equal(
        contents(project, 'src/modules/identity/identity.module.ts').includes(
          auth === 'local' ? 'FirebaseTokenVerifier' : 'ArgonPasswords',
        ),
        false,
      );
      const migration = contents(project, 'src/initialize-database.ts');
      assert.equal(/media|push|notes/.test(migration), false);
      if (database === 'postgres')
        assert.ok(
          contents(project, 'migrations/001-identity.sql').includes(
            'CREATE TABLE',
          ),
        );
      if (auth === 'firebase')
        assert.equal(
          contents(
            project,
            'src/modules/identity/firebase-identity.controller.ts',
          ).includes('local-identity.controller'),
          false,
        );
      assertImports(project);
    });
  }

for (const storage of ['local', 'aws-s3', 'r2'])
  test(`storage ${storage} emits only selected SDK and named profile`, async () => {
    const project = await render(config(`storage.${storage}`));
    assert.equal(
      !!packages(project)['@aws-sdk/client-s3'],
      storage !== 'local',
    );
    assert.equal(
      project.files.some((f) => f.path.endsWith('s3-storage.service.ts')),
      storage !== 'local',
    );
    assert.equal(
      project.files.some((f) => f.path.endsWith('local-storage.service.ts')),
      true,
    );
    assert.equal(
      project.files.some((f) => f.path.endsWith('upload-receiver.service.ts')),
      false,
    );
    if (storage === 'local')
      assert.equal(
        contents(project, 'src/modules/storage/storage.service.ts').includes(
          'S3StorageService',
        ),
        false,
      );
    else
      assert.equal(
        contents(project, 'src/core/config/load-config.ts').includes(
          `s3Profile: '${storage === 'r2' ? 'r2' : 'aws'}'`,
        ),
        true,
      );
    if (storage !== 'local') {
      const provider = contents(
        project,
        'src/modules/storage/s3-storage.service.ts',
      );
      assert.match(provider, /storageProfileName\(record\.profile\) === 'aws'/);
      assert.match(
        contents(project, 'src/modules/storage/storage.entity.ts'),
        new RegExp(`profile: '${storage === 'aws-s3' ? 'aws' : 'r2'}'`),
      );
    }
    assertImports(project);
  });

for (const database of ['mongodb', 'postgres'])
  test(`media and purpose-specific push preserve ${database} ownership/fencing implementation`, async () => {
    const project = await render(
      config(
        `database.${database}`,
        'auth.local',
        'mail.capture',
        'storage.local',
        'media.private',
        'push.apns',
      ),
    );
    assert.equal(packages(project)['firebase-admin'], undefined);
    assert.equal(packages(project)['@aws-sdk/client-s3'], undefined);
    assert.match(
      contents(project, 'src/modules/media/media.service.ts'),
      /finalizing/,
    );
    assert.match(
      contents(project, 'src/modules/push/push.service.ts'),
      /generation|fence|revision/,
    );
    assert.equal(
      contents(project, 'src/modules/push/push.module.ts').includes(
        'FcmPushService',
      ),
      false,
    );
    assertImports(project);
  });

for (const realtime of ['socket-io', 'native-ws', 'centrifugo'])
  test(`realtime ${realtime} exports only selected transport`, async () => {
    const project = await render(
      config(
        'database.mongodb',
        'auth.local',
        'mail.capture',
        `realtime.${realtime}`,
      ),
    );
    assert.equal(!!packages(project)['socket.io'], realtime === 'socket-io');
    assert.equal(!!packages(project).ws, realtime === 'native-ws');
    const client = realtime === 'socket-io' ? 'socket-io' : realtime;
    assert.ok(project.files.some((f) => f.path === `clients/${client}.mjs`));
    assert.ok(project.files.some((f) => f.path === 'clients/auth-local.mjs'));
    assert.match(
      contents(project, 'src/modules/realtime/realtime.module.ts'),
      /exports: \[RealtimeService,/,
    );
    const hasTickets = realtime !== 'socket-io';
    const startupConfig = contents(project, 'src/core/config/load-config.ts');
    assert.equal(
      startupConfig.includes('REALTIME_TICKET_TTL_SECONDS'),
      hasTickets,
    );
    assert.equal(startupConfig.includes('ticketTtlSeconds'), hasTickets);
    assert.equal(
      project.developmentDefaults?.REALTIME_TICKET_TTL_SECONDS,
      hasTickets ? '30' : undefined,
    );
    assert.equal(
      project.files.some((file) => file.path.startsWith('.env.')),
      false,
    );
    if (realtime === 'centrifugo') {
      assert.equal(
        project.developmentDefaults?.CENTRIFUGO_API_URL,
        'http://127.0.0.1:9000/api',
      );
      assert.match(
        contents(project, 'ops/centrifugo/compose.yml'),
        /centrifugo\/centrifugo:v6\.10\.3/,
      );
      assert.match(
        contents(project, 'ops/centrifugo/README.md'),
        /CENTRIFUGO_CALLBACK_HEADERS/,
      );
    }
    assertImports(project);
  });

test('selected diagnostics and deployment ship operation assets without provider initialization', async () => {
  const selected = config('diagnostics.local', 'deployment.caprover');
  selected.capabilities.diagnostics!.options = {
    mcp: true,
    vector: true,
    logdy: true,
  };
  const project = await render(selected);
  assert.ok(packages(project)['@modelcontextprotocol/sdk']);
  assert.ok(contents(project, 'ops/diagnostics/vector.yaml'));
  assert.ok(contents(project, 'ops/diagnostics/logdy-live.sh'));
  assert.ok(contents(project, 'captain-definition'));
  assert.equal(
    /firebase-admin|mongoose|from 'pg'/.test(
      contents(project, 'scripts/diagnostics-mcp.mjs'),
    ),
    false,
  );
  for (const file of project.files)
    assert.equal(
      /examples\/|\/home\/orca|Hand-built expected-output|hand-built reference/.test(
        file.content,
      ),
      false,
      file.path,
    );
  assertImports(project);
});

test('options and requirements fail before a file set exists', async () => {
  await assert.rejects(render(config('media.private')), /MISSING_CAPABILITY/);
  await assert.rejects(
    render(config('auth.local', 'database.mongodb')),
    /MISSING_CAPABILITY:mail/,
  );
  for (const [id, options] of [
    ['auth.firebase', { actionDelivery: 'unsupported' }],
    ['realtime.native-ws', { scale: 'unsupported' }],
    ['storage.r2', { multipart: true }],
    ['diagnostics.local', { remote: true }],
    ['deployment.dokploy', { operator: true }],
  ] as const) {
    const recipe = recipeCatalog.recipes.find((r) => r.id === id)!;
    assert.throws(() => recipe.validateOptions(options));
  }
  assert.throws(
    () =>
      recipeCatalog.recipes
        .find((r) => r.id === 'auth.firebase')!
        .validateOptions({ methods: ['apple', 'apple'] }),
    /INVALID_FIREBASE_METHODS/,
  );
});

test('name-only scaffolds are typed, native and unexposed', async () => {
  for (const kind of [
    'service',
    'controller',
    'dto',
    'command',
    'query',
  ] as const) {
    const generated = await renderScaffold(config(), {
      kind,
      name: 'export-record',
    });
    assert.ok(generated.files.every((f) => f.ownership === 'scaffold'));
    for (const file of generated.files)
      assert.equal(
        /@(Get|Post|Put|Patch|Delete|SubscribeMessage)\(/.test(file.content),
        false,
      );
    assert.ok(generated.pending.length);
  }
  for (const database of ['mongodb', 'postgres']) {
    const selected = config(`database.${database}`);
    const result = await renderScaffold(selected, {
      kind: 'feature',
      name: 'project-item',
    });
    assert.match(
      contents(result, 'src/modules/project-item/project-item.service.ts'),
      /extends BaseRepository<ProjectItem>/,
    );
    assert.match(
      contents(result, 'src/modules/project-item/project-item.module.ts'),
      /imports: \[DatabaseModule\]/,
    );
    const merged = await render(selected);
    merged.files.push(...result.files);
    assertImports(merged);
  }
  const databaseFeature = await renderScaffold(config('database.postgres'), {
    kind: 'feature',
    name: 'database',
  });
  assert.match(
    contents(databaseFeature, 'src/modules/database/database.module.ts'),
    /imports: \[VcliDatabaseModule\]/,
  );
  for (const kind of ['feature', 'repository'] as const) {
    const name = 'mongo-record';
    const generated = await renderScaffold(config('database.mongodb'), {
      kind,
      name,
    });
    const entity = contents(generated, `src/modules/${name}/${name}.entity.ts`);
    assert.equal(entity.match(/new Schema</g)?.length, 1);
    assert.match(entity, /_id: \{ type: String, required: true \}/);
    assert.match(
      entity,
      /id: \{ type: String, required: true, unique: true \}/,
    );
    assert.match(entity, /collection: 'mongo_record'/);
    assert.doesNotMatch(entity, /\$jsonSchema|\.add\(/);
  }
  await assert.rejects(
    renderScaffold(config(), { kind: 'repository', name: 'entry' }),
    /DATABASE_REQUIRED/,
  );
  await assert.rejects(
    renderScaffold(config(), { kind: 'service', name: '../escape' }),
    /INVALID_OR_RESERVED/,
  );
  const basic = config('database.mongodb', 'auth.local');
  basic.capabilities.auth!.options.profile = 'basic';
  await assert.rejects(
    renderScaffold(basic, { kind: 'dto', name: 'auth' }),
    /INVALID_OR_RESERVED_SCAFFOLD_NAME/,
  );
  const customAuth = await renderScaffold(config(), {
    kind: 'dto',
    name: 'auth',
  });
  assert.equal(customAuth.files[0]?.path, 'src/modules/auth/auth.dto.ts');
  await assert.rejects(
    renderScaffold(config(), { kind: 'realtime', name: 'updates' }),
    /AUTH_AND_REALTIME_REQUIRED/,
  );
});

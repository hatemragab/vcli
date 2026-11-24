import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { format } from 'prettier';
import { Script } from 'node:vm';
import type { ProjectConfig, RecipeCatalog, Recipe } from '../src/contracts.ts';
import { deploymentFiles } from '../dist/recipes/render-deployment.js';
import { diagnosticsFiles } from '../dist/recipes/render-diagnostics.js';
import { serviceFiles } from '../dist/recipes/render-services.js';
import { planInit, planAdd, applyPlan } from '../dist/engine/index.js';

const fields = [
  {
    key: 'PUBLIC_ORIGIN',
    required: false,
    secret: false,
    defaultValue: 'https://api.example.invalid',
  },
  { key: 'DATABASE_URL', required: true, secret: true },
  { key: 'SMTP_PASSWORD', required: false, secret: true },
  {
    key: 'SESSION_TTL_SECONDS',
    required: false,
    secret: false,
    defaultValue: '86400',
  },
];
function config(target: string, extra: string[] = []): ProjectConfig {
  return {
    schemaVersion: 1,
    project: { name: 'render-api', packageManager: 'npm' },
    capabilities: Object.fromEntries(
      ['foundation.nest', `deployment.${target}`, ...extra].map((recipe) => [
        recipe.split('.')[0]!,
        { recipe, options: {} },
      ]),
    ),
  };
}
async function fixture(t: test.TestContext): Promise<string> {
  const base = path.resolve('var/cli-operations');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'deploy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('all three native artifact profiles are deterministic, managed and distinct', () => {
  for (const target of ['dokploy', 'coolify', 'caprover']) {
    const selected = config(target, [
      'database.postgres',
      'storage.local',
      'diagnostics.local',
    ]);
    const files = deploymentFiles(selected, fields);
    assert.deepEqual(files, deploymentFiles(selected, fields));
    assert.ok(files.every((file) => file.ownership === 'managed'));
    assert.equal(
      files.some(
        (file) =>
          file.path.includes('ops/centrifugo/') ||
          file.path.includes('ops/diagnostics/'),
      ),
      false,
    );
    const get = (name: string) =>
      files.find((file) => file.path === name)!.content;
    if (target === 'caprover') {
      assert.deepEqual(JSON.parse(get('captain-definition')), {
        schemaVersion: 2,
        dockerfilePath: './ops/Dockerfile',
      });
      assert.equal(
        files.some((file) => file.path.endsWith('compose.yaml')),
        false,
      );
      const settings = JSON.parse(
        get('ops/deploy/caprover/app-settings.json'),
      ) as {
        settings: {
          containerHttpPort: number;
          instanceCount: number;
          ports: unknown[];
        };
        preprovisioned: unknown[];
        apply: boolean;
      };
      assert.equal(settings.settings.containerHttpPort, 3100);
      assert.equal(settings.settings.instanceCount, 1);
      assert.deepEqual(settings.settings.ports, []);
      assert.equal(settings.apply, false);
      assert.equal(settings.preprovisioned.length, 1);
    } else {
      const compose = JSON.parse(get(`ops/deploy/${target}/compose.yaml`)) as {
        services: {
          api: {
            build: { context: string };
            ports?: unknown[];
            mem_limit: string;
          };
          release: { profiles: string[]; restart: string };
        };
        volumes: Record<string, { external: boolean }>;
      };
      assert.equal(
        compose.services.api.build.context,
        target === 'coolify' ? '.' : '../../..',
      );
      assert.equal(compose.services.api.ports, undefined);
      assert.equal(compose.services.api.mem_limit, '512m');
      assert.equal(compose.services.release.restart, 'no');
      assert.deepEqual(compose.services.release.profiles, ['operations']);
      assert.ok(
        Object.values(compose.volumes).every((volume) => volume.external),
      );
    }
    const docker = get('ops/Dockerfile');
    assert.match(docker, /npm ci --install-links/);
    assert.match(docker, /npm prune --omit=dev --install-links/);
    assert.doesNotMatch(docker, /node_modules\/@vcli\/auth-runtime/);
    assert.match(docker, /USER node/);
    assert.match(docker, /install -d -m 0700 -o node -g node/);
    const runtime = docker.split(' AS runtime\n')[1]!;
    assert.equal(
      /COPY .*\/app\/(?:src|tools)\b|\bARG\b|\.env/.test(runtime),
      false,
    );
    assert.match(runtime, /runtime-assets\/migrations/);
    assert.match(runtime, /\/app\/dist/);
    assert.match(get('.dockerignore'), /\*\*\/\.env\*/);
    assert.equal(
      files.some(
        (file) =>
          file.content.includes('/home/orca') ||
          file.content.includes('examples/reference'),
      ),
      false,
    );
  }
});

test('private sentinel never enters artifacts, build arguments or public plan', () => {
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'PRIVATE_SENTINEL';
  try {
    const files = deploymentFiles(
      config('dokploy', ['database.postgres']),
      fields,
    );
    assert.equal(JSON.stringify(files).includes('PRIVATE_SENTINEL'), false);
    assert.deepEqual(
      files
        .find((file) => file.path === 'ops/Dockerfile')!
        .content.split('\n')
        .filter((line) => line.startsWith('ARG ')),
      ['ARG VCLI_SOURCE_COMMIT'],
    );
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});

test('Docker shell steps copy only selected diagnostic launchers and retain valid syntax', async () => {
  const local = 'scripts/diagnostics-mcp.mjs';
  const remote = [
    'scripts/diagnostics-private-profile.mjs',
    'scripts/diagnostics-remote-backend.mjs',
  ];
  const profiles = [
    { options: {}, scripts: [] },
    { options: { mcp: true }, scripts: [local] },
    { options: { reader: 'restricted-remote-read' }, scripts: remote },
    {
      options: { mcp: true, reader: 'restricted-remote-read' },
      scripts: [local, ...remote, 'scripts/diagnostics-remote-mcp.mjs'],
    },
  ] as const;
  for (const { options, scripts } of profiles) {
    const selected = config('dokploy', [
      'database.postgres',
      'diagnostics.local',
    ]);
    selected.capabilities.diagnostics!.options = { ...options };
    const diagnostics = await diagnosticsFiles(selected);
    assert.deepEqual(
      diagnostics
        .map(({ path }) => path)
        .filter((path) => path.startsWith('scripts/')),
      scripts,
    );
    const docker = deploymentFiles(selected, fields).find(
      ({ path }) => path === 'ops/Dockerfile',
    )!.content;
    assert.deepEqual(
      docker.match(/scripts\/diagnostics-[a-z-]+\.mjs/g) ?? [],
      scripts,
    );
    assert.doesNotMatch(docker, /scripts\/diagnostics-\*/);
    assert.equal(
      docker.includes('/runtime-assets/scripts'),
      scripts.length > 0,
    );
    for (const line of docker
      .split('\n')
      .filter((line) => line.startsWith('RUN '))) {
      const result = spawnSync('sh', ['-n'], {
        input: line.slice(4),
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
    const match = /CMD node -e "([^"]+)"/.exec(docker);
    assert.ok(match);
    assert.doesNotThrow(() => new Script(match[1]!));
    const command = /^CMD (\[.+\])$/m.exec(docker);
    assert.ok(command);
    assert.deepEqual(JSON.parse(command[1]!), ['node', 'dist/main.js']);
  }
});

test('native Compose config parses raw and formatted JSON/YAML profiles without services or pulls', async (t) => {
  const compose = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
  });
  if (compose.status !== 0) {
    t.skip('Docker Compose CLI is unavailable');
    return;
  }
  const root = await fixture(t);
  for (const target of ['dokploy', 'coolify']) {
    for (const file of deploymentFiles(
      config(target, ['database.postgres', 'storage.local']),
      fields,
    )) {
      const absolute = path.join(root, file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(
        absolute,
        file.path.endsWith('.yaml')
          ? await format(file.content, {
              parser: 'yaml',
              singleQuote: true,
              trailingComma: 'all',
            })
          : file.content,
      );
    }
    const args = [
      'compose',
      '--project-directory',
      target === 'coolify' ? root : path.join(root, `ops/deploy/${target}`),
      '-f',
      path.join(root, `ops/deploy/${target}/compose.yaml`),
      'config',
      '--no-interpolate',
      '--format',
      'json',
    ];
    const result = spawnSync('docker', args, {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, COMPOSE_DISABLE_ENV_FILE: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      services: { api: { environment: Record<string, string> } };
    };
    assert.equal(parsed.services.api.environment.SMTP_PASSWORD, null);
  }
  for (const database of ['mongodb', 'postgres']) {
    const selected: ProjectConfig = {
      ...config('dokploy'),
      capabilities: {
        foundation: { recipe: 'foundation.nest', options: {} },
        database: { recipe: `database.${database}`, options: {} },
      },
    };
    for (const file of serviceFiles(selected, [])) {
      const absolute = path.join(root, file.path);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, file.content);
    }
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--project-directory',
        root,
        '-f',
        path.join(root, 'ops/local/compose.yaml'),
        'config',
        '--no-interpolate',
        '--format',
        'json',
      ],
      {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, COMPOSE_DISABLE_ENV_FILE: '1' },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      services: {
        database: { ports: { host_ip: string }[]; cgroup_parent: string };
      };
    };
    assert.equal(parsed.services.database.ports[0]!.host_ip, '127.0.0.1');
    assert.equal(
      parsed.services.database.cgroup_parent,
      '${VCLI_CGROUP_PARENT:-}',
    );
  }
});

test('existing engine rejects edits to managed deployment artifacts and preserves user bytes', async (t) => {
  const workspace = await fixture(t),
    project = path.join(workspace, 'app');
  const recipes: Recipe[] = [
    'foundation.nest',
    'deployment.caprover',
    'diagnostics.local',
  ].map((id) => ({
    id,
    family: id.split('.')[0]!,
    version: '0.1.1',
    requires: id === 'foundation.nest' ? [] : ['foundation'],
    conflicts: [],
    validateOptions: () => ({}),
  }));
  const catalog: RecipeCatalog = {
    recipes,
    render: async (selected) => ({
      files: [
        {
          path: 'package.json',
          ownership: 'managed',
          content: JSON.stringify({
            name: 'render-api',
            version: '0.1.0',
            private: true,
            scripts: {},
            dependencies: {},
            devDependencies: {},
          }),
        },
        ...deploymentFiles(selected, []),
      ],
      checks: [],
      warnings: [],
      pending: [],
    }),
  };
  const plan = await planInit({
    workspaceDir: workspace,
    projectDir: project,
    config: config('caprover'),
    catalog,
  });
  await applyPlan(plan);
  const edited = path.join(project, 'ops/Dockerfile');
  await writeFile(edited, 'USER_CUSTOMIZED_ARTIFACT\n');
  await assert.rejects(
    planAdd({
      projectDir: project,
      selections: { diagnostics: { recipe: 'diagnostics.local', options: {} } },
      catalog,
    }),
    /managed|modified|changed|conflict/i,
  );
  assert.equal(await readFile(edited, 'utf8'), 'USER_CUSTOMIZED_ARTIFACT\n');
});

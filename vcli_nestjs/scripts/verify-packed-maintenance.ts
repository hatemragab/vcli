import { TOOL_VERSION } from '../dist/contracts.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GenerationPlan } from '../src/engine/types.js';

type Engine = typeof import('../src/engine/index.js');
type Maintenance = typeof import('../src/maintenance/index.js');
const repository = resolve('.');
const historicalEvidence = join(repository, 'var/cli-evidence/maintenance');
const evidence = join(
  repository,
  'var/cli-evidence',
  `maintenance-${TOOL_VERSION}`,
);
await mkdir(evidence, { recursive: true, mode: 0o700 });
await chmod(evidence, 0o700);
const workspace = await mkdtemp(join(tmpdir(), 'vcli-maintenance-gate-'));
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
  LANG: 'C.UTF-8',
  NODE_ENV: 'test',
  NO_COLOR: '1',
  npm_config_offline: 'true',
  npm_config_fetch_retries: '0',
};
const sentinel = 'SYNTHETIC_MAINTENANCE_PRIVATE_ENV_914d';
const records: {
  name: string;
  command?: string;
  exitCode?: number | null;
  elapsedMs?: number;
  status: 'passed' | 'failed' | 'observed-failure';
}[] = [];
const historical =
  process.env.VCLI_MAINTENANCE_REUSE_HISTORY === '1'
    ? (JSON.parse(
        await readFile(
          join(historicalEvidence, 'historical-observations.json'),
          'utf8',
        ),
      ) as {
        facts: Record<string, unknown>;
        records: typeof records;
        timestamp: string;
      })
    : undefined;
if (historical) {
  assert.equal(
    (historical.facts.historical as { sha256: string }).sha256,
    'c0103c720a3ea20917026fefaee9c4489ee0419101baa40b7a1255be0db672b0',
  );
  for (const baseline of [
    'historicalMinimalBaseline',
    'historicalCaptureBaseline',
  ])
    assert.equal(
      (historical.facts[baseline] as { checks: string }).checks,
      'failed',
    );
  assert.equal(
    (historical.facts.historicalMinimal as { source: string }).source,
    'refused-before-writes',
  );
  assert.equal(
    (historical.facts.historicalCapture as { targetSource: string })
      .targetSource,
    'refused-before-writes',
  );
  records.push(
    ...historical.records.filter((record) =>
      record.name.startsWith('historical-'),
    ),
  );
}
const facts: Record<string, unknown> = {
  outsideCheckout: true,
  offline: true,
  downloadBytes: 0,
  runtimeMode: 'Nest init and injected capture without opening a listener',
  noProviderOrDatabaseCalls: true,
  ...(historical
    ? Object.fromEntries(
        Object.entries(historical.facts).filter(([key]) =>
          key.startsWith('historical'),
        ),
      )
    : {}),
  ...(historical
    ? {
        historicalEvidenceReuse: {
          ledger: 'historical-observations.json',
          timestamp: historical.timestamp,
        },
      }
    : {}),
};
let success = false;
function safe(value: string): string {
  return value.replaceAll(sentinel, '[REDACTED]');
}
async function run(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  expected: number | 'nonzero' = 0,
): Promise<string> {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16000000,
  });
  const matches =
    expected === 'nonzero'
      ? result.status !== null && result.status !== 0
      : result.status === expected;
  records.push({
    name,
    command: [command, ...args].join(' '),
    exitCode: result.status,
    elapsedMs: Date.now() - started,
    status: matches
      ? result.status === 0
        ? 'passed'
        : 'observed-failure'
      : 'failed',
  });
  await writeFile(
    join(evidence, name + '.log'),
    safe(result.stdout + result.stderr),
    { mode: 0o600 },
  );
  console.log(
    `${name}: ${matches ? (expected === 'nonzero' ? 'HISTORICAL FAILURE RECORDED' : 'passed') : 'FAILED'} (${Date.now() - started}ms)`,
  );
  assert.ifError(result.error);
  assert.equal(matches, true, `See ${name}.log`);
  return result.stdout;
}
async function cli(
  name: string,
  executable: string,
  args: string[],
  cwd = workspace,
  expected: number | 'nonzero' = 0,
): Promise<Record<string, unknown>> {
  const result: unknown = JSON.parse(
    await run(
      name,
      process.execPath,
      [executable, ...args, '--json'],
      cwd,
      expected,
    ),
  );
  assert.ok(result && typeof result === 'object');
  return result as Record<string, unknown>;
}
async function assertion(
  name: string,
  check: () => Promise<void>,
): Promise<void> {
  try {
    await check();
    records.push({ name, status: 'passed' });
    console.log(name + ': passed');
  } catch (error) {
    records.push({ name, status: 'failed' });
    throw error;
  }
}
const digest = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');
async function json(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}
async function privateSnapshot(project: string): Promise<Map<string, string>> {
  const selected = [
    'vcli.json',
    'vcli.lock.json',
    'package.json',
    'README.md',
    'src/app.custom.module.ts',
    '.env.development',
  ];
  const result = new Map<string, string>();
  for (const file of selected)
    result.set(file, await readFile(join(project, file), 'utf8'));
  return result;
}
async function customize(project: string): Promise<Map<string, string>> {
  await writeFile(
    join(project, 'src/app.custom.module.ts'),
    (await readFile(join(project, 'src/app.custom.module.ts'), 'utf8')) +
      '\n// Developer integration remains byte-for-byte.\n',
  );
  await writeFile(
    join(project, '.env.development'),
    `PRIVATE_SENTINEL=${sentinel}\n`,
    { mode: 0o600 },
  );
  const manifest = await json(join(project, 'package.json'));
  (manifest.scripts as Record<string, unknown>)['custom:maintenance'] =
    'node -e "process.exit(0)"';
  manifest.custom = { untouched: true };
  (manifest.dependencies as Record<string, unknown>).ms = '2.1.3';
  await writeJson(join(project, 'package.json'), manifest);
  await writeFile(
    join(project, 'README.md'),
    (await readFile(join(project, 'README.md'), 'utf8')) +
      '\nDeveloper maintenance notes remain.\n',
  );
  return privateSnapshot(project);
}
async function assertCustomized(
  project: string,
  before: Map<string, string>,
): Promise<void> {
  for (const file of ['src/app.custom.module.ts', '.env.development'])
    assert.equal(await readFile(join(project, file), 'utf8'), before.get(file));
  assert.ok(
    (await readFile(join(project, 'README.md'), 'utf8')).endsWith(
      '\nDeveloper maintenance notes remain.\n',
    ),
  );
  const manifest = await json(join(project, 'package.json'));
  assert.equal(
    (manifest.scripts as Record<string, unknown>)['custom:maintenance'],
    'node -e "process.exit(0)"',
  );
  assert.deepEqual(manifest.custom, { untouched: true });
  assert.equal((manifest.dependencies as Record<string, unknown>).ms, '2.1.3');
}
async function installTool(name: string, tarball: string): Promise<string> {
  const directory = join(workspace, name);
  await mkdir(directory, { recursive: true });
  await writeJson(join(directory, 'package.json'), {
    name,
    private: true,
    dependencies: { '@vcli/cli': `file:${tarball}` },
  });
  await run(
    name + '-install',
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--install-links',
    ],
    directory,
  );
  return join(directory, 'node_modules/@vcli/cli/bin/vcli.mjs');
}
async function pack(
  name: string,
  cwd: string,
): Promise<{ file: string; sha256: string; bytes: number; files: string[] }> {
  const directory = join(workspace, 'packs', name);
  await mkdir(directory, { recursive: true });
  const output = JSON.parse(
    await run(
      'pack-' + name,
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', directory, '--json'],
      cwd,
    ),
  ) as { filename: string; size: number; files: { path: string }[] }[];
  const entry = output[0]!;
  const file = join(directory, entry.filename);
  const sha256 = digest(await readFile(file));
  assert.ok(entry.size < 500000000);
  const retained = join(evidence, `${name}-${sha256.slice(0, 12)}.tgz`);
  await cp(file, retained);
  await chmod(retained, 0o600);
  return {
    file,
    sha256,
    bytes: entry.size,
    files: entry.files.map((item) => item.path),
  };
}
async function runtime(
  name: string,
  project: string,
  capture: boolean,
): Promise<void> {
  const file = join(project, 'maintenance-runtime-probe.mjs');
  await writeFile(
    file,
    `import assert from 'node:assert/strict';
import {createApp} from './dist/create-app.js';
import {loadConfig} from './dist/core/config/load-config.js';
import {HealthStateService} from './dist/modules/health/health-state.service.js';
${capture ? "import {MailService} from './dist/modules/mail/mail.service.js';" : ''}
const runtime=await createApp(loadConfig({NODE_ENV:'test'}));
try {assert.equal(runtime.app.get(HealthStateService).ready(),true);${capture ? "const result=await runtime.app.get(MailService).submit({operationId:'12345678-1234-4123-8123-123456789abc',purpose:'notification',to:'reader@example.invalid',subject:'Maintenance',text:'SYNTHETIC_PRIVATE_CAPTURE'});assert.equal(result.status,'captured');" : ''}console.log('MAINTENANCE_RUNTIME_OK');}
finally {await runtime.close();}
`,
  );
  assert.match(
    await run(name, process.execPath, [file], project),
    /MAINTENANCE_RUNTIME_OK/,
  );
}
try {
  const historyTarball = join(repository, 'var/vcli-cli-0.1.0.tgz');
  const historyBytes = await readFile(historyTarball);
  const historyManifest = JSON.parse(
    await run(
      'inspect-historical-manifest',
      'tar',
      ['-xOzf', historyTarball, 'package/package.json'],
      workspace,
    ),
  ) as Record<string, unknown>;
  const listing = (
    await run(
      'inspect-historical-files',
      'tar',
      ['-tzf', historyTarball],
      workspace,
    )
  )
    .trim()
    .split('\n');
  assert.equal(historyManifest.version, '0.1.0');
  assert.equal(
    listing.some((file) =>
      file.startsWith('package/runtime-packages/auth-runtime/'),
    ),
    false,
  );
  facts.historical = {
    sha256: digest(historyBytes),
    bytes: historyBytes.byteLength,
    authAssets: false,
    label: 'actual historical bootstrap, not curated auth predecessor',
  };
  const target = await pack('target-cli', repository);
  assert.ok(
    target.files.includes('runtime-packages/auth-runtime/package.json'),
  );
  facts.target = {
    sha256: target.sha256,
    bytes: target.bytes,
    version: TOOL_VERSION,
  };
  const oldCli = historical
    ? ''
    : await installTool('old-tool', historyTarball);
  const targetCli = await installTool('target-tool', target.file);
  const targetRoot = join(workspace, 'target-tool/node_modules/@vcli/cli');
  const engine = (await import(
    pathToFileURL(join(targetRoot, 'dist/engine/index.js')).href
  )) as Engine;
  const maintenance = (await import(
    pathToFileURL(join(targetRoot, 'dist/maintenance/index.js')).href
  )) as Maintenance;
  const { recipeCatalog } = (await import(
    pathToFileURL(join(targetRoot, 'dist/recipes/index.js')).href
  )) as typeof import('../src/recipes/index.js');
  const { withLocalDistribution } = (await import(
    pathToFileURL(join(targetRoot, 'dist/distribution.js')).href
  )) as typeof import('../src/distribution.js');
  let catalog = withLocalDistribution(recipeCatalog);
  const inspector = (await import(
    pathToFileURL(join(targetRoot, 'dist/engine/inspection.js')).href
  )) as typeof import('../src/engine/inspection.js');
  if (!historical) {
    const oldMinimal = join(workspace, 'historical-minimal'),
      oldCapture = join(workspace, 'historical-capture');
    for (const [label, project, capture] of [
      ['historical-minimal', oldMinimal, false],
      ['historical-capture', oldCapture, true],
    ] as const) {
      await cli(label + '-init', oldCli, [
        'init',
        project,
        '--name',
        label,
        '--yes',
        '--skip-install',
        ...(capture ? ['--mail', 'capture'] : []),
      ]);
      await cli(label + '-install', oldCli, [
        '--project',
        project,
        'install',
        '--offline',
      ]);
      const localCli = join(project, 'node_modules/@vcli/cli/bin/vcli.mjs');
      await cli(
        label + '-check-known-failure',
        localCli,
        ['check'],
        project,
        'nonzero',
      );
      await run(
        label + '-build-known-failure',
        'npm',
        ['run', 'build'],
        project,
        'nonzero',
      );
      const buildFailure = await readFile(
        join(evidence, label + '-build-known-failure.log'),
        'utf8',
      );
      assert.match(
        buildFailure,
        capture ? /TS2345|TS2367/ : /unknown.*DynamicModule|TS2322/s,
      );
      facts[
        capture ? 'historicalCaptureBaseline' : 'historicalMinimalBaseline'
      ] = {
        install: 'completed',
        checks: 'failed',
        build: 'failed',
        runtime: 'not-claimed',
        reason: capture
          ? 'actual bootstrap capture environment type excludes production while bootstrap source references it (TS2345/TS2367)'
          : 'actual bootstrap empty capability map is inferred as unknown[] (TS2322)',
      };
    }
    const minimalBefore = await customize(oldMinimal);
    const minimalDenied = await cli(
      'historical-minimal-refusal',
      targetCli,
      [
        '--project',
        oldMinimal,
        'upgrade',
        '--to',
        TOOL_VERSION,
        '--skip-install',
      ],
      workspace,
      1,
    );
    assert.ok(JSON.stringify(minimalDenied).includes('UNSUPPORTED_BASELINE'));
    assert.deepEqual(await privateSnapshot(oldMinimal), minimalBefore);
    facts.historicalMinimal = {
      source: 'refused-before-writes',
      install: 'old-offline-install-completed',
      checks: 'old-failed-TS2322',
      build: 'old-failed',
      runtime: 'not-claimed',
      reason:
        'unrecognized pre-acceptance snapshot; scaffold log schema ownership cannot be silently adopted',
    };
    const captureBefore = await customize(oldCapture);
    const priorOperations = await readdir(
      join(oldCapture, '.vcli/local/operations'),
    );
    const denied = await cli(
      'historical-capture-refusal',
      targetCli,
      [
        '--project',
        oldCapture,
        'upgrade',
        '--to',
        TOOL_VERSION,
        '--skip-install',
      ],
      workspace,
      1,
    );
    assert.ok(JSON.stringify(denied).includes('UNSUPPORTED_BASELINE'));
    assert.deepEqual(await privateSnapshot(oldCapture), captureBefore);
    assert.deepEqual(
      await readdir(join(oldCapture, '.vcli/local/operations')),
      priorOperations,
    );
    const oldDesired = await json(join(oldCapture, 'vcli.json')),
      oldLock = await json(join(oldCapture, 'vcli.lock.json'));
    (
      oldDesired.capabilities as Record<string, { options: unknown }>
    ).mail!.options = { reliableActions: false };
    oldLock.config = oldDesired;
    await writeJson(join(oldCapture, 'vcli.json'), oldDesired);
    await writeJson(join(oldCapture, 'vcli.lock.json'), oldLock);
    const normalizedBefore = await privateSnapshot(oldCapture);
    const normalizedDenial = await cli(
      'historical-capture-normalized-refusal',
      targetCli,
      [
        '--project',
        oldCapture,
        'upgrade',
        '--to',
        TOOL_VERSION,
        '--skip-install',
      ],
      workspace,
      1,
    );
    assert.ok(
      JSON.stringify(normalizedDenial).includes('UNSUPPORTED_BASELINE'),
    );
    assert.deepEqual(await privateSnapshot(oldCapture), normalizedBefore);
    facts.historicalCapture = {
      oldInstall: 'completed',
      oldChecks: 'failed',
      oldBuild: 'failed',
      oldRuntime: 'not-claimed',
      targetSource: 'refused-before-writes',
      reason:
        'bootstrap runtime API predates curated mail lifecycle; normalization cannot adopt it',
    };
  }
  // Reconstruct the curated profile from the identified 0.1.1 artifact.
  const predecessorDigest =
    '4b0d6f0263ae500dc3be2d740f0e6559583f6294cc8a1c594ebd792eb7c3f326';
  const predecessor = join(
    historicalEvidence,
    `target-cli-${predecessorDigest.slice(0, 12)}.tgz`,
  );
  assert.equal(digest(await readFile(predecessor)), predecessorDigest);
  const predecessorCli = await installTool('curated-base-tool', predecessor);
  const curated = join(workspace, 'synthetic-curated');
  await cli('curated-init-from-predecessor', predecessorCli, [
    'init',
    curated,
    '--name',
    'synthetic-curated',
    '--yes',
    '--mail',
    'capture',
    '--skip-install',
  ]);
  const definition = engine.getSourceMigration(
    'copied.mail-subject-controls-v1',
  );
  const copiedPath = join(curated, definition.path);
  const copiedTarget = await readFile(copiedPath, 'utf8');
  assert.equal(
    engine.previewSourceMigration(definition.id, copiedTarget).status,
    'already-applied',
  );
  await writeFile(
    copiedPath,
    copiedTarget.replace(definition.newSection, definition.oldSection),
  );
  const vendorManifestPath = join(curated, 'tools/vcli/package.json'),
    vendorManifest = await json(vendorManifestPath);
  vendorManifest.version = '0.1.0';
  await writeJson(vendorManifestPath, vendorManifest);
  const curatedLockPath = join(curated, 'vcli.lock.json'),
    curatedLock = await json(curatedLockPath);
  curatedLock.toolVersion = '0.1.0';
  for (const recipe of curatedLock.recipes as { version: string }[])
    recipe.version = '0.1.0';
  (curatedLock.files as Record<string, { hash: string }>)[
    'tools/vcli/package.json'
  ]!.hash = digest(await readFile(vendorManifestPath));
  await writeJson(curatedLockPath, curatedLock);
  const bootstrapManifestHash = digest(await readFile(vendorManifestPath));
  await run(
    'curated-bootstrap-tool-dependencies',
    'npm',
    [
      '--prefix',
      'tools/vcli',
      'install',
      '--offline',
      '--omit=dev',
      '--ignore-scripts',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
    ],
    curated,
  );
  assert.equal(
    digest(await readFile(vendorManifestPath)),
    bootstrapManifestHash,
  );
  await cli(
    'curated-install-predecessor',
    join(curated, 'tools/vcli/bin/vcli.mjs'),
    ['--project', curated, 'install', '--offline'],
  );
  await cli('curated-check-predecessor', targetCli, [
    '--project',
    curated,
    'check',
  ]);
  await run('curated-build-predecessor', 'npm', ['run', 'build'], curated);
  await runtime('curated-runtime-predecessor', curated, true);
  const curatedBefore = await customize(curated);
  const planned = await maintenance.planMaintenanceUpgrade({
    projectDir: curated,
    targetVersion: TOOL_VERSION,
    catalog,
  });
  assert.equal(planned.codemods[0]?.status, 'planned');
  const saved = join(workspace, 'curated-plan.json');
  await engine.savePlan(planned.plan, saved);
  assert.equal((await stat(saved)).mode & 0o777, 0o600);
  await assertion('curated-contract-drift-refusal', async () => {
    const contract = join(curated, 'src/modules/mail/capture-mail.service.ts');
    const before = await readFile(contract, 'utf8');
    await writeFile(
      contract,
      before + '\n// intervening developer contract edit\n',
    );
    await assert.rejects(
      engine.applyPlan(await engine.readPlan(saved)),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'STALE_PLAN',
    );
    assert.equal(
      await readFile(contract, 'utf8'),
      before + '\n// intervening developer contract edit\n',
    );
    await writeFile(contract, before);
  });
  await cli('curated-apply-source', targetCli, [
    'apply',
    saved,
    '--skip-install',
  ]);
  assert.deepEqual((await engine.inspectProject(curated)).outcomes, {
    source: 'completed',
    install: 'pending',
    checks: 'pending',
  });
  await cli('curated-install-target', targetCli, [
    '--project',
    curated,
    'install',
    '--offline',
  ]);
  const installedLocal = join(curated, 'node_modules/@vcli/cli/bin/vcli.mjs');
  await cli('curated-check-target', installedLocal, ['check'], curated);
  await run('curated-build-target', 'npm', ['run', 'build'], curated);
  await run('curated-tests-target', 'npm', ['test'], curated);
  await runtime('curated-runtime-target', curated, true);
  await assertCustomized(curated, curatedBefore);
  assert.equal(
    engine.previewSourceMigration(
      definition.id,
      await readFile(copiedPath, 'utf8'),
    ).status,
    'already-applied',
  );
  assert.equal(
    (await json(join(curated, 'node_modules/@vcli/cli/package.json'))).version,
    TOOL_VERSION,
  );
  const repeated = await maintenance.planMaintenanceUpgrade({
    projectDir: curated,
    targetVersion: TOOL_VERSION,
    catalog,
  });
  assert.deepEqual(repeated.plan.changes, []);
  facts.curated = {
    label: 'synthetic curated predecessor, not historical/published CLI0.1.0',
    baselineProfile: 'curated-capture-immediate-v1',
    source: 'completed',
    install: 'completed',
    checks: 'completed',
    build: 'passed',
    runtime: 'captured-and-closed',
    copiedMigration: definition.id,
    idempotent: true,
    customizedBytesPreserved: true,
  };

  const baseCatalog = catalog;
  catalog = {
    recipes: baseCatalog.recipes,
    async render(config, resolved) {
      const result = await baseCatalog.render(config, resolved);
      const payload = result.files.find(
        (file) => file.path === 'tools/vcli/dist/engine/data.js',
      );
      assert.ok(payload);
      payload.content += '\n// SAME_VERSION_PAYLOAD_FIXTURE\n';
      return result;
    },
  };
  const sameVersion = await engine.planUpgrade({
    projectDir: curated,
    catalog,
  });
  await engine.applyPlan(sameVersion);
  assert.equal(await inspector.installationHealthy(curated), false);
  assert.notEqual(
    (await engine.inspectProject(curated)).outcomes.install,
    'completed',
  );
  assert.notEqual(
    (await maintenance.inspectMaintenance(curated)).components.find(
      (component) => component.id === 'cli',
    )?.installation,
    'completed',
  );
  await cli('curated-same-version-reinstall', targetCli, [
    '--project',
    curated,
    'install',
    '--offline',
  ]);
  assert.equal(await inspector.installationHealthy(curated), true);
  assert.equal(
    await readFile(
      join(curated, 'node_modules/@vcli/cli/dist/engine/data.js'),
      'utf8',
    ),
    await readFile(join(curated, 'tools/vcli/dist/engine/data.js'), 'utf8'),
  );
  await cli('curated-same-version-check', installedLocal, ['check'], curated);
  facts.sameVersionCliPayload = {
    version: TOOL_VERSION,
    sourceBytesChanged: true,
    staleInstalledPayloadRejected: true,
    actualNamedReinstallationCopiedBytes: true,
  };

  // Real npm packing and optional-peer-free consumers of a clearly labeled synthetic auth predecessor.
  const authOldSource = join(workspace, 'auth-predecessor');
  await cp(join(targetRoot, 'runtime-packages/auth-runtime'), authOldSource, {
    recursive: true,
  });
  const authManifest = await json(join(authOldSource, 'package.json'));
  authManifest.version = '0.1.0';
  await writeJson(join(authOldSource, 'package.json'), authManifest);
  for (const file of ['dist/index.js', 'dist/index.d.ts']) {
    const content = await readFile(join(authOldSource, file), 'utf8');
    const updated = content.replace(
      /^export (?:declare )?const AUTH_RUNTIME_VERSION[^\n]*\n?/m,
      '',
    );
    assert.notEqual(updated, content);
    await writeFile(join(authOldSource, file), updated);
  }
  const authOld = await pack('synthetic-auth-0-1-0', authOldSource),
    authTarget = await pack(
      `auth-${TOOL_VERSION.replaceAll('.', '-')}`,
      join(targetRoot, 'runtime-packages/auth-runtime'),
    );
  const authConsumer = join(workspace, 'auth-consumer');
  await mkdir(authConsumer);
  await writeJson(join(authConsumer, 'package.json'), {
    name: 'peer-free-auth-consumer',
    private: true,
    type: 'module',
    dependencies: { '@vcli/auth-runtime': `file:${authOld.file}` },
  });
  await run(
    'auth-install-old-tarball',
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--install-links',
    ],
    authConsumer,
  );
  const authProbe = join(authConsumer, 'probe.mjs');
  await writeFile(
    authProbe,
    `import assert from 'node:assert/strict';import {existsSync} from 'node:fs';import * as root from '@vcli/auth-runtime';import {createOpaqueCapability,hashOpaqueCapability,opaqueCapabilityMatches} from '@vcli/auth-runtime/opaque';import {AuthRuntimeError} from '@vcli/auth-runtime/errors';
const token=createOpaqueCapability();assert.equal(token.length,43);const hash=hashOpaqueCapability(token,'action-token');assert.equal(opaqueCapabilityMatches(token,hash,'action-token'),true);assert.equal(opaqueCapabilityMatches(token,hash,'refresh-token'),false);assert.throws(()=>hashOpaqueCapability('bad','action-token'),error=>error instanceof AuthRuntimeError&&error.code==='INVALID_OPAQUE_CAPABILITY');assert.equal(existsSync('node_modules/jose'),false);assert.equal(existsSync('node_modules/argon2'),false);assert.equal(root.AUTH_RUNTIME_VERSION,process.argv[2]==='new'?${JSON.stringify(TOOL_VERSION)}:undefined);console.log('AUTH_COMPATIBLE');`,
  );
  assert.match(
    await run(
      'auth-old-consumer',
      process.execPath,
      ['probe.mjs', 'old'],
      authConsumer,
    ),
    /AUTH_COMPATIBLE/,
  );
  await run(
    'auth-install-target-tarball',
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--install-links',
      authTarget.file,
    ],
    authConsumer,
  );
  assert.match(
    await run(
      'auth-target-consumer',
      process.execPath,
      ['probe.mjs', 'new'],
      authConsumer,
    ),
    /AUTH_COMPATIBLE/,
  );
  const copiedAuth = join(authConsumer, 'vendor/auth-runtime');
  await mkdir(join(authConsumer, 'vendor'));
  await cp(authOldSource, copiedAuth, { recursive: true });
  await run(
    'auth-install-copied-old',
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--install-links',
      'file:vendor/auth-runtime',
    ],
    authConsumer,
  );
  assert.equal(await inspector.installationHealthy(authConsumer), true);
  await cp(join(targetRoot, 'runtime-packages/auth-runtime'), copiedAuth, {
    recursive: true,
  });
  assert.equal(await inspector.installationHealthy(authConsumer), false);
  await run(
    'auth-reinstall-copied-target',
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--install-links',
      '@vcli/auth-runtime@file:vendor/auth-runtime',
    ],
    authConsumer,
  );
  assert.equal(await inspector.installationHealthy(authConsumer), true);
  assert.match(
    await run(
      'auth-copied-target-consumer',
      process.execPath,
      ['probe.mjs', 'new'],
      authConsumer,
    ),
    /AUTH_COMPATIBLE/,
  );
  const opaquePath = join(copiedAuth, 'dist/opaque.js');
  await writeFile(
    opaquePath,
    (await readFile(opaquePath, 'utf8')) +
      '\n// SAME_VERSION_AUTH_PAYLOAD_FIXTURE\n',
  );
  assert.equal(await inspector.installationHealthy(authConsumer), false);
  await run(
    'auth-remove-stale-same-version',
    'npm',
    [
      'uninstall',
      '--offline',
      '--no-save',
      '--package-lock=false',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '@vcli/auth-runtime',
    ],
    authConsumer,
  );
  await run(
    'auth-reinstall-same-version-payload',
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--install-links',
      '@vcli/auth-runtime@file:vendor/auth-runtime',
    ],
    authConsumer,
  );
  assert.equal(await inspector.installationHealthy(authConsumer), true);
  assert.equal(
    await readFile(
      join(authConsumer, 'node_modules/@vcli/auth-runtime/dist/opaque.js'),
      'utf8',
    ),
    await readFile(opaquePath, 'utf8'),
  );
  facts.auth = {
    predecessor: 'synthetic curated private0.1.0, not historical release',
    oldTarball: authOld.sha256,
    targetTarball: authTarget.sha256,
    oldPackedConsumer: 'passed',
    targetPackedConsumer: 'passed',
    optionalPeersAbsent: true,
    copiedManifestDriftDetected: true,
    copiedTargetReinstalled: true,
    sameVersionPayloadDriftRejectedAndReinstalled: true,
  };

  await assertion('manual-custom-function-route', async () => {
    const customized = (await readFile(copiedPath, 'utf8')).replace(
      'message.text.length > 32768',
      'message.text.length > 32767',
    );
    await writeFile(copiedPath, customized);
    const manual = await maintenance.planMaintenanceUpgrade({
      projectDir: curated,
      targetVersion: TOOL_VERSION,
      catalog,
    });
    assert.equal(manual.manual.length, 1);
    assert.ok(
      !manual.plan.changes.some((change) => change.path === definition.path),
    );
    await engine.applyPlan(manual.plan);
    assert.equal(await readFile(copiedPath, 'utf8'), customized);
    assert.match(
      await readFile(join(curated, manual.manual[0]!.patchPath), 'utf8'),
      /DEMONSTRATION/,
    );
    assert.equal(
      maintenance
        .reportAdvisories(await maintenance.inspectMaintenance(curated))
        .find((finding) => finding.component === 'copied-mail-rendering')
        ?.status,
      'unknown',
    );
  });
  const failurePackagePath = join(curated, 'package.json'),
    failurePackage = await json(failurePackagePath);
  (failurePackage.scripts as Record<string, unknown>).preinstall =
    'node -e "process.exit(23)"';
  await writeJson(failurePackagePath, failurePackage);
  await cli(
    'controlled-real-install-failure',
    targetCli,
    ['--project', curated, 'install', '--offline'],
    workspace,
    1,
  );
  assert.equal(
    (await engine.inspectProject(curated)).outcomes.install,
    'failed',
  );
  const failedRepeat = await maintenance.planMaintenanceUpgrade({
    projectDir: curated,
    targetVersion: TOOL_VERSION,
    catalog,
  });
  assert.deepEqual(failedRepeat.plan.changes, []);
  assert.equal(
    (await engine.applyPlan(failedRepeat.plan)).outcomes.install,
    'failed',
  );
  delete (failurePackage.scripts as Record<string, unknown>).preinstall;
  await writeJson(failurePackagePath, failurePackage);
  await cli('repair-real-install-failure', targetCli, [
    '--project',
    curated,
    'install',
    '--offline',
  ]);
  await cli('check-after-install-repair', targetCli, [
    '--project',
    curated,
    'check',
  ]);
  await assertion('stale-plan-and-interruption-recovery', async () => {
    const stale = await engine.planScaffold({
      projectDir: curated,
      files: [
        {
          path: 'src/maintenance-stale.ts',
          ownership: 'scaffold',
          content: 'export const state = 1;\n',
        },
      ],
    });
    await writeFile(
      join(curated, 'src/maintenance-stale.ts'),
      '// later developer bytes\n',
    );
    await assert.rejects(
      engine.applyPlan(stale),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'STALE_PLAN',
    );
    assert.equal(
      await readFile(join(curated, 'src/maintenance-stale.ts'), 'utf8'),
      '// later developer bytes\n',
    );
    const interrupted: GenerationPlan = await engine.planScaffold({
      projectDir: curated,
      files: [
        {
          path: 'src/maintenance-interrupted.ts',
          ownership: 'scaffold',
          content: 'export const state = 2;\n',
        },
      ],
    });
    await assert.rejects(
      engine.applyPlan(interrupted, { failAfterWrites: 1 }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'SOURCE_FAILED',
    );
    await writeFile(
      join(curated, 'src/maintenance-interrupted.ts'),
      '// post-interruption developer edit\n',
    );
    const recovered = await engine.recoverOperation(curated);
    assert.equal(recovered.status, 'conflicted');
    assert.ok(recovered.conflicts.includes('src/maintenance-interrupted.ts'));
    assert.equal(
      await readFile(join(curated, 'src/maintenance-interrupted.ts'), 'utf8'),
      '// post-interruption developer edit\n',
    );
  });
  facts.failureEvidence = {
    realNpmPreinstallFailed: true,
    failedInstallNotRepairedBySourceNoop: true,
    explicitInstallRepair: true,
    unsupportedCustomFunctionUntouched: true,
    staleCreatePreserved: true,
    interruptedRecoveryPreservedLaterEdit: true,
  };
  success = true;
} finally {
  await writeFile(
    join(evidence, 'results.json'),
    JSON.stringify(
      {
        success,
        workspace,
        timestamp: new Date().toISOString(),
        records,
        facts,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  if (success) await rm(workspace, { recursive: true });
  else console.error('Preserved task-owned failed fixture: ' + workspace);
}

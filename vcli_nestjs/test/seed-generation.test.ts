import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../bin/vcli.mjs', import.meta.url));

function vcli(cwd: string, args: string[]) {
  const child = spawnSync(
    process.execPath,
    [executable, ...args, '--skip-install', '--json'],
    { cwd, encoding: 'utf8', timeout: 45_000 },
  );
  assert.ifError(child.error);
  return {
    status: child.status,
    result: JSON.parse(child.stdout) as {
      data?: { pending?: string[] };
      errors?: { code: string }[];
    },
    output: child.stdout + child.stderr,
  };
}

for (const database of ['mongodb', 'postgres', 'none'] as const) {
  test(`generated ${database}: seed entry points and custom scaffold ownership`, async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), 'vcli-seed-generation-'));
    t.after(() => rm(workspace, { recursive: true, force: true }));
    const root = join(workspace, 'api');
    const selected = database !== 'none';
    const init = vcli(workspace, [
      'init',
      'api',
      '--yes',
      ...(selected ? ['--database', database] : []),
    ]);
    assert.equal(init.status, 0, init.output);
    const manifest = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };
    const makefile = await readFile(join(root, 'Makefile'), 'utf8');
    assert.equal(Object.hasOwn(manifest.scripts, 'db:seed'), selected);
    assert.equal(/^seed:/mu.test(makefile), selected);
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (name !== 'db:seed') assert.doesNotMatch(command, /\bdb:seed\b/);
    }

    const feature = vcli(root, ['g', 'feature', 'orders']);
    assert.equal(feature.status, 0, feature.output);
    const service = vcli(root, ['g', 'service', 'invoices']);
    assert.equal(service.status, 0, service.output);
    const lock = JSON.parse(
      await readFile(join(root, 'vcli.lock.json'), 'utf8'),
    ) as {
      files: Record<string, { ownership: string }>;
    };
    for (const file of [
      'scripts/seed.mjs',
      'src/core/database/module-seeder.ts',
      'src/generated/selected-seeders.ts',
      'src/seed/run-seeds.ts',
    ]) {
      assert.equal(
        lock.files[file]?.ownership,
        selected ? 'managed' : undefined,
      );
    }
    const seed = 'src/modules/orders/orders.seed.ts';
    const registry = 'src/seed/custom-seeders.ts';
    assert.ok(!lock.files['src/modules/invoices/invoices.seed.ts']);
    assert.equal(
      lock.files[seed]?.ownership,
      selected ? 'scaffold' : undefined,
    );
    assert.equal(
      lock.files[registry]?.ownership,
      selected ? 'scaffold' : undefined,
    );
    if (!selected) return;

    const originalSeed = await readFile(join(root, seed), 'utf8');
    const originalRegistry = await readFile(join(root, registry), 'utf8');
    assert.match(originalSeed, /SEED_FIXTURES_NOT_IMPLEMENTED/u);
    assert.match(
      feature.result.data?.pending?.join('\n') ?? '',
      /seedOrders.*custom-seeders\.ts/u,
    );
    await writeFile(
      join(root, seed),
      originalSeed + '\n// Developer seed edit.\n',
    );
    await writeFile(
      join(root, registry),
      originalRegistry + '\n// Developer registry edit.\n',
    );
    const duplicate = vcli(root, ['g', 'feature', 'orders']);
    assert.equal(duplicate.status, 1, duplicate.output);
    assert.equal(duplicate.result.errors?.[0]?.code, 'MANAGED_CONFLICT');
    assert.equal(
      await readFile(join(root, seed), 'utf8'),
      originalSeed + '\n// Developer seed edit.\n',
    );
    assert.equal(
      await readFile(join(root, registry), 'utf8'),
      originalRegistry + '\n// Developer registry edit.\n',
    );
  });
}

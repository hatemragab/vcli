import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { checkArchitecture } from '../scripts/architecture-rules.ts';

async function fixture(files: Readonly<Record<string, string>>) {
  const directory = await mkdtemp(join(tmpdir(), 'vcli-architecture-'));
  for (const [name, contents] of Object.entries(files)) {
    const file = join(directory, 'src', name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  try {
    return await checkArchitecture(join(directory, 'src'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('application has flat modules, one class per file and no circular dependencies', async () => {
  const result = await checkArchitecture(resolve('src'));
  assert.deepEqual(result.failures, []);
});

test('dependency check accepts a one-way graph with shared types', async () => {
  const result = await fixture({
    'core/facts.ts': 'export type Account = { id: string };',
    'modules/account/account.service.ts':
      "import type { Account } from '../../core/facts.js'; export class AccountService { find(): Account { return { id: 'one' }; } }",
    'modules/auth/auth.service.ts':
      "import { AccountService } from '../account/account.service.js'; export class AuthService { constructor(readonly accounts: AccountService) {} }",
  });
  assert.deepEqual(result.failures, []);
});

test('dependency check rejects cycles through type imports and re-exports', async () => {
  const result = await fixture({
    'modules/a/a.ts':
      "import type { B } from './b.js'; export type A = { b: B };",
    'modules/a/b.ts': "export type { A as B } from './a.js';",
  });
  assert.ok(
    result.failures.some((failure) => failure.startsWith('File import cycle:')),
  );
});

test('dependency check rejects a feature cycle even when the individual files are acyclic', async () => {
  const result = await fixture({
    'modules/a/a.service.ts':
      "import type { B } from '../b/b.entity.js'; export type AService = B;",
    'modules/a/a.entity.ts': 'export type A = { id: string };',
    'modules/b/b.service.ts':
      "import type { A } from '../a/a.entity.js'; export type BService = A;",
    'modules/b/b.entity.ts': 'export type B = { id: string };',
  });
  assert.ok(
    result.failures.some((failure) =>
      failure.startsWith('Feature dependency cycle:'),
    ),
  );
  assert.ok(
    !result.failures.some((failure) =>
      failure.startsWith('File import cycle:'),
    ),
  );
});

test('dependency check rejects feature imports from core', async () => {
  const result = await fixture({
    'core/auth.ts':
      "import type { Account } from '../modules/account/account.entity.js'; export type Actor = Account;",
    'modules/account/account.entity.ts':
      'export type Account = { id: string };',
  });
  assert.ok(
    result.failures.some((failure) => failure.includes('core cannot import')),
  );
});

test('dependency check rejects aliased forwardRef and service-locator escape hatches', async () => {
  const result = await fixture({
    'core/bad.ts':
      "import { forwardRef as later, Global } from '@nestjs/common'; import { ModuleRef } from '@nestjs/core'; export const tokens = [later, Global, ModuleRef];",
  });
  for (const name of ['forwardRef', 'Global', 'ModuleRef'])
    assert.ok(
      result.failures.some((failure) =>
        failure.includes(`prohibited dependency shortcut ${name}`),
      ),
    );
});

test('dependency check rejects computed loading and unresolved local imports', async () => {
  const result = await fixture({
    'core/bad.ts':
      "export const load = (name: string) => import(name); export { value } from './missing.js';",
  });
  assert.ok(
    result.failures.some((failure) =>
      failure.includes('dynamic dependency loading'),
    ),
  );
  assert.ok(
    result.failures.some((failure) =>
      failure.includes('unresolved import ./missing.js'),
    ),
  );
});

import { constants } from 'node:fs';
import { chmod, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { canonical, hash, validateToolchain } from './data.js';
import { correlateFailure, EngineError } from './engine-error.js';
import { installationHealthy } from './inspection.js';
import {
  listJournals,
  privateDirectory,
  unfinishedJournals,
  withProjectLock,
  writeJournal,
} from './operation-storage.js';
import {
  assertNoSymlinks,
  checkExpected,
  initEntries,
  isErrno,
  projectPath,
  readRegular,
  statOrNull,
} from './paths.js';
import { validatePlan } from './saved-plan.js';
import { readProject } from './state.js';
import { previewSourceMigration } from './source-migrations.js';
import type {
  ApplyOptions,
  ApplyResult,
  GenerationPlan,
  OperationJournal,
} from './types.js';

async function verifyPlan(plan: GenerationPlan): Promise<void> {
  await assertNoSymlinks(plan.workspaceDir);
  await assertNoSymlinks(plan.projectDir);
  if (plan.kind === 'init') {
    const entries = await initEntries(plan.projectDir);
    if (JSON.stringify(entries) !== JSON.stringify(plan.initialEntries))
      throw new EngineError(
        'STALE_PLAN',
        'preconditions',
        'The init target changed; create a fresh plan.',
      );
  } else {
    const previous = await readProject(plan.projectDir);
    for (const [family, selection] of Object.entries(
      previous.config.capabilities,
    )) {
      if (canonical(plan.config.capabilities[family]) !== canonical(selection))
        throw new EngineError(
          'STATE_DRIFT',
          'preconditions',
          'A saved plan cannot switch or remove installed selections.',
        );
    }
    if (
      plan.kind === 'scaffold' &&
      (canonical(plan.config) !== canonical(previous.config) ||
        canonical(plan.recipes) !== canonical(previous.lock.recipes))
    )
      throw new EngineError(
        'INVALID_PLAN',
        'preconditions',
        'Scaffolding cannot change realized capability choices.',
      );
    for (const change of plan.changes) {
      if (['vcli.json', 'vcli.lock.json'].includes(change.path)) continue;
      const ownership = previous.lock.files[change.path];
      const migration = plan.sourceMigrations?.find(
        (candidate) => candidate.path === change.path,
      );
      if (migration) {
        const before = await readRegular(
          await projectPath(plan.projectDir, change.path),
        );
        const transformed = before
          ? previewSourceMigration(migration.id, before.toString('utf8'))
          : null;
        if (
          ownership?.ownership !== 'scaffold' ||
          !transformed ||
          transformed.status !== 'supported' ||
          transformed.content !== change.content
        )
          throw new EngineError(
            'MANAGED_CONFLICT',
            'migration',
            'Actual copied source no longer has the exact supported migration shape; replan or review the manual patch.',
          );
      }
      if (
        (ownership?.ownership === 'scaffold' && !migration) ||
        (ownership && ownership.ownership !== change.ownership) ||
        (!ownership && change.expected.kind !== 'absent')
      )
        throw new EngineError(
          'MANAGED_CONFLICT',
          'preconditions',
          'A saved plan cannot adopt existing source or rewrite developer scaffolds.',
        );
      if (plan.kind === 'scaffold' && change.ownership !== 'scaffold')
        throw new EngineError(
          'INVALID_PLAN',
          'preconditions',
          'Scaffolding may only create developer-owned source paths.',
        );
    }
  }
  if (unfinishedJournals(await listJournals(plan.projectDir)).length)
    throw new EngineError(
      'INCOMPLETE_OPERATION',
      'apply',
      'Recover the earlier interrupted source operation first.',
    );
  for (const guard of plan.guards)
    await checkExpected(
      await projectPath(plan.projectDir, guard.path),
      guard.expected,
    );
  for (const change of plan.changes)
    await checkExpected(
      await projectPath(plan.projectDir, change.path),
      change.expected,
    );
}
async function sourceDirectory(
  projectDir: string,
  relative: string,
  journal: OperationJournal,
): Promise<void> {
  const directory = path.posix.dirname(relative);
  if (directory === '.') return;
  let cursor = '';
  for (const part of directory.split('/')) {
    cursor = cursor ? `${cursor}/${part}` : part;
    const full = await projectPath(projectDir, cursor);
    if (!(await statOrNull(full))) {
      try {
        await mkdir(full, { mode: 0o755 });
      } catch (error) {
        if (isErrno(error, 'EEXIST'))
          throw new EngineError(
            'STALE_PLAN',
            'apply',
            'A source directory appeared during apply; recover and replan.',
          );
        throw error;
      }
      // Never claim a concurrently created directory. A crash before this record can
      // leave an empty task directory, which is safer than deleting an unowned one.
      journal.createdDirectories.push(cursor);
      await writeJournal(journal);
    }
  }
}
export async function applyPlan(
  input: GenerationPlan,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const plan = validatePlan(input);
  validateToolchain();
  if (
    options.failAfterWrites !== undefined &&
    (!Number.isSafeInteger(options.failAfterWrites) ||
      options.failAfterWrites < 0)
  )
    throw new EngineError(
      'INVALID_OPTIONS',
      'apply',
      'Choose a nonnegative fault-injection write count.',
    );
  await assertNoSymlinks(plan.projectDir);
  await assertNoSymlinks(plan.workspaceDir);
  return withProjectLock(plan.projectDir, async () => {
    await verifyPlan(plan);
    if (!plan.changes.length) {
      const outcomes = {
        ...(await readProject(plan.projectDir)).lock.outcomes,
      };
      if (
        outcomes.install === 'completed' &&
        !(await installationHealthy(plan.projectDir))
      ) {
        outcomes.install = 'failed';
        outcomes.checks = 'pending';
      }
      return {
        operationId: plan.id,
        changed: [],
        outcomes,
        pending: [...plan.pending],
      };
    }
    if (!(await statOrNull(plan.projectDir)))
      await mkdir(plan.projectDir, { mode: 0o755 });
    // Catch files that appeared between the initial absence check and target mkdir.
    if (plan.kind === 'init') await initEntries(plan.projectDir);
    const journal: OperationJournal = {
      schemaVersion: 1,
      id: plan.id,
      projectDir: plan.projectDir,
      status: 'applying',
      outcomes: { ...plan.outcomes, source: 'pending' },
      entries: [],
      createdDirectories: [],
    };
    for (const change of plan.changes) {
      const before = await readRegular(
        await projectPath(plan.projectDir, change.path),
      );
      journal.entries.push({
        path: change.path,
        before: before?.toString('base64') ?? null,
        afterHash: change.hash,
        status: 'pending',
      });
    }
    await writeJournal(journal);
    const staging = await privateDirectory(
      plan.projectDir,
      `.vcli/local/stages/${plan.id}`,
    );
    let written = 0;
    try {
      for (const [index, change] of plan.changes.entries()) {
        const stage = path.join(staging, `${index}.txt`);
        await assertNoSymlinks(stage);
        const handle = await open(
          stage,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(change.content);
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      for (const [index, change] of plan.changes.entries()) {
        if (options.failAfterWrites === written)
          throw new EngineError(
            'SOURCE_FAILED',
            'source',
            'Injected source interruption; recover this operation before retrying.',
          );
        await sourceDirectory(plan.projectDir, change.path, journal);
        const target = await projectPath(plan.projectDir, change.path);
        await checkExpected(target, change.expected);
        const stage = path.join(staging, `${index}.txt`);
        await assertNoSymlinks(stage);
        if (hash((await readRegular(stage)) ?? '') !== change.hash)
          throw new EngineError(
            'SOURCE_FAILED',
            'source',
            'The private staging file changed; recover and replan.',
          );
        if (change.expected.kind === 'absent') {
          const handle = await open(
            target,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o644,
          );
          try {
            await handle.writeFile(change.content);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await unlink(stage);
        } else {
          const stat = await statOrNull(target);
          await chmod(stage, stat ? Number(stat.mode) & 0o777 : 0o644);
          await checkExpected(target, change.expected);
          await rename(stage, target);
        }
        journal.entries[index]!.status = 'written';
        written += 1;
      }
      const state = await readProject(plan.projectDir);
      journal.outcomes = { ...state.lock.outcomes };
      journal.status = 'source-completed';
      await writeJournal(journal);
      await rm(staging, { recursive: true, force: true }).catch(
        () => undefined,
      );
      const outcomes = { ...journal.outcomes };
      if (
        outcomes.install === 'completed' &&
        !(await installationHealthy(plan.projectDir))
      ) {
        outcomes.install = 'failed';
        outcomes.checks = 'pending';
      }
      return {
        operationId: plan.id,
        changed: plan.changes.map((change) => change.path),
        outcomes,
        pending: [...plan.pending],
      };
    } catch (error) {
      journal.status = 'failed';
      journal.outcomes.source = 'failed';
      await writeJournal(journal);
      const correlated = correlateFailure(error, plan.id);
      if (correlated instanceof EngineError) throw correlated;
      throw new EngineError(
        'SOURCE_FAILED',
        'source',
        'Source application failed; inspect and recover the recorded operation.',
        { operationId: plan.id },
      );
    }
  });
}

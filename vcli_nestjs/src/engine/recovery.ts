import { rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './data.js';
import {
  developmentEnvFile,
  recoverDevelopmentEnvironment,
} from './development-environment.js';
import { readProject } from './state.js';
import { correlateFailure, EngineError } from './engine-error.js';
import {
  listJournals,
  unfinishedJournals,
  withProjectLock,
  writeJournal,
  writePrivate,
} from './operation-storage.js';
import {
  assertNoSymlinks,
  isErrno,
  projectPath,
  readRegular,
} from './paths.js';
import type { RecoveryOptions, RecoveryResult } from './types.js';

/** Rollback is byte-conditional and cannot undo npm scripts or external effects. */
export async function recoverOperation(
  projectDir: string,
  options: RecoveryOptions = {},
): Promise<RecoveryResult> {
  const absolute = path.resolve(projectDir);
  await assertNoSymlinks(absolute);
  return withProjectLock(
    absolute,
    async () => {
      let currentId = options.operationId;
      try {
        const journals = await listJournals(absolute);
        const candidates = options.operationId
          ? journals.filter((journal) => journal.id === options.operationId)
          : unfinishedJournals(journals);
        if (candidates.length !== 1)
          throw new EngineError(
            'INCOMPLETE_OPERATION',
            'recovery',
            'Select exactly one recorded interrupted operation by its operation ID.',
          );
        const journal = candidates[0]!;
        currentId = journal.id;
        if (journal.status === 'recovered')
          return {
            operationId: journal.id,
            restored: [],
            conflicts: [],
            status: 'recovered',
            externalEffects: 'not-reverted',
          };
        if (journal.outcomes.source === 'completed') {
          const current = await readProject(absolute);
          if (current.lock.operationId !== journal.id)
            throw new EngineError(
              'RECOVERY_CONFLICT',
              'recovery',
              'A newer source operation exists; recover only the current operation before considering an earlier rollback.',
            );
        }
        // Preflight every entry before any restore, including forged journal paths.
        for (const entry of journal.entries)
          await projectPath(absolute, entry.path);
        for (const directory of journal.createdDirectories)
          await projectPath(absolute, directory);
        const restored: string[] = [];
        const conflicts: string[] = [];
        const development = await recoverDevelopmentEnvironment(journal);
        // Preserve the ignore rules and remaining project if the owner changed the private file.
        if (development === 'conflict')
          return {
            operationId: journal.id,
            restored,
            conflicts: [developmentEnvFile],
            status: 'conflicted',
            externalEffects: 'not-reverted',
          };
        if (development === 'removed') restored.push(developmentEnvFile);
        for (const entry of [...journal.entries].reverse()) {
          if (entry.status === 'restored') continue;
          const target = await projectPath(absolute, entry.path);
          const current = await readRegular(target);
          const before =
            entry.before === null ? null : Buffer.from(entry.before, 'base64');
          if (
            (current === null && before === null) ||
            (current && before && current.equals(before))
          ) {
            entry.status = 'restored';
            await writeJournal(journal);
            continue;
          }
          if (!current || hash(current) !== entry.afterHash) {
            conflicts.push(entry.path);
            continue;
          }
          // Check again immediately before mutating to preserve ordinary concurrent edits.
          if (hash((await readRegular(target)) ?? '') !== entry.afterHash) {
            conflicts.push(entry.path);
            continue;
          }
          if (before === null) await unlink(target);
          else await writePrivate(target, before);
          entry.status = 'restored';
          restored.push(entry.path);
          await writeJournal(journal);
        }
        // Remove only directories explicitly recorded as created, and only when empty.
        for (const directory of [...journal.createdDirectories].sort(
          (a, b) => b.length - a.length,
        )) {
          try {
            await rmdir(await projectPath(absolute, directory));
          } catch (error) {
            if (
              !isErrno(error, 'ENOENT') &&
              !isErrno(error, 'ENOTEMPTY') &&
              !isErrno(error, 'EEXIST')
            )
              throw new EngineError(
                'RECOVERY_CONFLICT',
                'recovery',
                'Review the recorded directory permissions without deleting unrelated content.',
              );
          }
        }
        journal.status = conflicts.length ? 'conflicted' : 'recovered';
        journal.outcomes.source = conflicts.length ? 'failed' : 'pending';
        journal.outcomes.install = 'pending';
        journal.outcomes.checks = 'pending';
        await writeJournal(journal);
        if (!conflicts.length) {
          const staging = await projectPath(
            absolute,
            `.vcli/local/stages/${journal.id}`,
            true,
          );
          await rm(staging, { recursive: true, force: true }).catch(
            () => undefined,
          );
        }
        return {
          operationId: journal.id,
          restored,
          conflicts,
          status: conflicts.length ? 'conflicted' : 'recovered',
          externalEffects: 'not-reverted',
        };
      } catch (error) {
        const correlated = correlateFailure(error, currentId);
        if (correlated instanceof EngineError) throw correlated;
        throw new EngineError(
          'RECOVERY_CONFLICT',
          'recovery',
          'Review the recorded operation before retrying recovery.',
          currentId ? { operationId: currentId } : {},
        );
      }
    },
    options.abandonLock ?? false,
  );
}

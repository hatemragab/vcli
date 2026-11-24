import type { Command } from 'commander';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { projectPath, readRegular } from '../engine/paths.js';
import { parseJson } from '../engine/data.js';
import { writeLastResult } from '../engine/last-result.js';
import { assertOwnerEnvFile } from '../services/dev-command.js';
import { runOwnedProcess } from '../services/owned-process.js';
import { parseScriptResult } from '../script-result.js';
import { CliError } from './cli-error.js';
import {
  assertPrivateInput,
  emitExit,
  requireInstalled,
  selectedProject,
  type OperationalCommandContext,
  type OperationalExecution,
} from './operational-shared.js';

interface ReleaseOptions {
  dryRun?: boolean;
  profile?: string;
  decision?: string;
  configFile?: string;
}

type ReleaseAction = 'apply' | 'reconcile' | 'backup' | 'restore';

const releaseScripts = {
  apply: ['release:apply', 'dist/initialize-database.js'],
  reconcile: ['release:reconcile', 'dist/release/reconcile-command.js'],
  backup: ['backup:create', 'dist/release/backup-command.js'],
  restore: ['backup:restore', 'dist/release/restore-command.js'],
} as const;

export function registerReleaseCommands(
  program: Command,
  context: OperationalCommandContext,
  execution: OperationalExecution,
  environment: () => NodeJS.ProcessEnv,
): void {
  const release = program
    .command('release')
    .description(
      'Delegate explicit selected release or operator-host backup scripts',
    );
  for (const action of ['apply', 'reconcile', 'backup', 'restore'] as const)
    release
      .command(action)
      .option(
        '--dry-run',
        'Preview the managed script without reading private input or starting a process',
      )
      .option('--profile <file>', 'Private backup/restore operator profile')
      .option(
        '--decision <file>',
        'Private quiesced release-reconciliation decision',
      )
      .option(
        '--config-file <file>',
        'Same owner-only private configuration file used by dev',
      )
      .action(async (options: ReleaseOptions) => {
        const operation = 'release.' + action;
        context.setOperation(operation);
        const root = context.project(),
          state = await selectedProject(root);
        if (!state.config.capabilities.database)
          throw new CliError(
            'RELEASE_DATABASE_REQUIRED',
            'Select and initialize exactly one native database before release operations.',
          );
        if (
          (options.profile && action !== 'backup' && action !== 'restore') ||
          (options.decision && action !== 'reconcile')
        )
          throw new CliError(
            'INVALID_RELEASE_INPUT',
            'Use --profile only for backup/restore and --decision only for reconcile.',
          );
        const [script, target] = releaseScripts[action as ReleaseAction];
        const packageBytes = await readRegular(
          await projectPath(root, 'package.json'),
        );
        const manifest = parseJson(packageBytes!.toString('utf8')) as {
          scripts?: Record<string, unknown>;
        };
        const expected = 'node ' + target;
        if (
          state.lock.packageFields['/scripts/' + script] !== expected ||
          manifest.scripts?.[script] !== expected
        )
          throw new CliError(
            'UNSUPPORTED_RELEASE_SCRIPT',
            'Restore the selected managed release/backup script before delegation.',
          );
        const data = { script, outcomes: state.outcomes };
        if (options.dryRun) {
          context.emit({
            schemaVersion: 1,
            status: 'preview',
            operation,
            data,
          });
          return;
        }
        requireInstalled(state.outcomes);
        const built = await lstat(await projectPath(root, target)).catch(
          () => undefined,
        );
        if (!built?.isFile() || built.isSymbolicLink())
          throw new CliError(
            'RELEASE_BUILD_REQUIRED',
            'Build the selected application before executing its managed release/backup script.',
          );
        const childEnvironment = { ...environment() };
        if (options.configFile) {
          const configFile = path.resolve(root, options.configFile);
          await assertOwnerEnvFile(configFile);
          childEnvironment.APP_ENV_FILE = configFile;
        }
        const inputName =
          action === 'backup'
            ? 'VCLI_BACKUP_PROFILE'
            : action === 'restore'
              ? 'VCLI_RESTORE_PROFILE'
              : action === 'reconcile'
                ? 'VCLI_RELEASE_DECISION'
                : undefined;
        const selectedInput =
          action === 'reconcile' ? options.decision : options.profile;
        if (inputName) {
          const file = selectedInput ?? childEnvironment[inputName];
          if (!file)
            throw new CliError(
              'RELEASE_PRIVATE_INPUT_REQUIRED',
              'Provide the selected private --profile or --decision file for this operation.',
            );
          const absolute = path.resolve(root, file);
          await assertPrivateInput(absolute);
          childEnvironment[inputName] = absolute;
        }
        const result = await (
          execution.releaseRunner ??
          ((invocation) => runOwnedProcess(invocation, { capture: true }))
        )({
          command: 'npm',
          args: ['run', '--silent', '--ignore-scripts', script],
          cwd: root,
          environment: childEnvironment,
        });
        const reported = parseScriptResult(result.stdout);
        const releaseData = {
          ...data,
          ...(reported?.releaseId ? { releaseId: reported.releaseId } : {}),
          ...(reported?.owners ? { owners: reported.owners } : {}),
          ...(reported?.step ? { step: reported.step } : {}),
          ...(reported?.keys ? { keys: reported.keys } : {}),
          ...(reported?.next ? { next: reported.next } : {}),
          ...(reported?.code ? { code: reported.code } : {}),
        };
        await writeLastResult(root, {
          schemaVersion: 1,
          at: new Date().toISOString(),
          operationId: state.lock.operationId,
          scope: 'release',
          status: result.code === 0 ? 'completed' : 'failed',
          step: reported?.step,
          code: reported?.code,
          exitCode: result.code,
          ...(result.signal ? { signal: result.signal } : {}),
          rerun: reported?.next,
        }).catch(() => undefined);
        emitExit(
          context,
          operation,
          releaseData,
          result,
          reported && result.code !== 0
            ? new CliError(
                reported.code,
                reported.next ??
                  'Review the release step, then run the next command it names.',
              )
            : undefined,
        );
      });
}

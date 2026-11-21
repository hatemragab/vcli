import { lstat } from 'node:fs/promises';
import type { ProjectConfig } from '../contracts.js';
import { inspectProject } from '../engine/inspection.js';
import { readProject } from '../engine/state.js';
import { validateToolchain } from '../engine/data.js';
import { resolveRecipes } from '../engine/resolve-recipes.js';
import { recipeCatalog } from '../recipes/catalog.js';
import { validateSelection } from '../recipes/selection.js';
import { configuration } from '../recipes/render-config.js';
import { describeServices } from '../recipes/service-plan.js';
import type { ServicePlan } from '../recipes/service-plan-types.js';
import type { ProjectOutcomes } from '../engine/types.js';
import type {
  ServiceRunner,
  CommandResult as ProcessResult,
} from '../services/service-types.js';
import { CliError } from './cli-error.js';
import { publicError, type CommandResult } from './command-output.js';

export interface OperationalCommandContext {
  project(): string;
  emit(result: CommandResult): void;
  setOperation(name: string): void;
  json(): boolean;
}

/** Explicit controlled execution seams; ordinary registration needs only program/context. */
export interface OperationalExecution {
  environment?: () => NodeJS.ProcessEnv;
  serviceRunner?: ServiceRunner;
  devRunner?: ServiceRunner;
  releaseRunner?: ServiceRunner;
}

export function localEnvironment(input: string): 'development' | 'test' {
  if (input !== 'development' && input !== 'test')
    throw new CliError(
      'INVALID_LOCAL_ENVIRONMENT',
      'Choose --environment development or test explicitly.',
    );
  return input;
}

export function localPort(input: string): number {
  if (!/^\d{1,5}$/.test(input) || Number(input) < 1024 || Number(input) > 65535)
    throw new CliError(
      'INVALID_LOCAL_PORT',
      'Choose one explicit port from 1024 through 65535.',
    );
  return Number(input);
}

export async function selectedProject(root: string): Promise<{
  config: ProjectConfig;
  outcomes: ProjectOutcomes;
  lock: Awaited<ReturnType<typeof readProject>>['lock'];
}> {
  validateToolchain();
  const state = await readProject(root);
  const resolved = resolveRecipes(state.config, recipeCatalog);
  validateSelection(resolved.config, resolved.recipes);
  const inspection = await inspectProject(root, state);
  if (
    inspection.outcomes.source !== 'completed' ||
    inspection.issues.some((issue) => issue.code !== 'INSTALL_INCOMPLETE')
  )
    throw new CliError(
      'OPERATIONAL_STATE_CONFLICT',
      'Resolve source/state/managed-file conflicts with inspect and recover before running operational commands.',
    );
  return {
    config: resolved.config,
    outcomes: inspection.outcomes,
    lock: state.lock,
  };
}

export function localPlan(
  config: ProjectConfig,
  environment: 'development' | 'test',
): ServicePlan {
  const capabilities = { ...config.capabilities };
  delete capabilities.deployment;
  return describeServices(
    { ...config, capabilities },
    configuration(config).fields,
    { environment },
  );
}

export function requireLocalProfile(
  lock: Awaited<ReturnType<typeof readProject>>['lock'],
  environment: string,
): void {
  for (const file of [
    `ops/local/${environment}/compose.yaml`,
    `ops/local/${environment}/service-plan.json`,
  ])
    if (lock.files[file]?.ownership !== 'managed')
      throw new CliError(
        'LOCAL_PROFILE_NOT_GENERATED',
        'Generate the supported managed development/test service profiles before this operation.',
      );
}

export function requireInstalled(outcomes: ProjectOutcomes): void {
  if (outcomes.install !== 'completed')
    throw new CliError(
      'OPERATION_DEPENDENCIES_PENDING',
      'Explicitly install the selected project dependencies before execution; a preview needs no installation.',
    );
}

export function emitExit(
  context: OperationalCommandContext,
  operation: string,
  data: Record<string, unknown>,
  result: ProcessResult,
  error?: unknown,
): void {
  if (!Number.isInteger(result.code) || result.code < 0 || result.code > 255)
    throw new CliError(
      'INVALID_OPERATION_EXIT',
      'The delegated command returned an unsupported exit status.',
    );
  context.emit({
    schemaVersion: 1,
    status: result.code === 0 ? 'completed' : 'failed',
    operation,
    data: {
      ...data,
      exitCode: result.code,
      ...(result.signal ? { signal: result.signal } : {}),
    },
    ...(result.code !== 0
      ? {
          errors: [
            error
              ? publicError(error)
              : {
                  code: 'DELEGATED_COMMAND_FAILED',
                  action:
                    'Review the selected operation privately and reconcile partial outcomes before retrying.',
                },
          ],
        }
      : {}),
  });
  process.exitCode = result.code;
}

export async function assertPrivateInput(file: string): Promise<void> {
  const info = await lstat(file).catch(() => {
    throw new CliError(
      'PRIVATE_OPERATION_FILE_UNAVAILABLE',
      'Provide an explicit accessible owner-only regular profile or decision file.',
    );
  });
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > 65536 ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    throw new CliError(
      'UNSAFE_PRIVATE_OPERATION_FILE',
      'Use an owner-only regular profile or decision file; its content is read only by the selected operation.',
    );
}

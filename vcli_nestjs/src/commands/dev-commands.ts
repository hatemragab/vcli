import type { Command } from 'commander';
import path from 'node:path';
import { statOrNull } from '../engine/paths.js';
import { executeDevCommand } from '../services/dev-command.js';
import { CliError } from './cli-error.js';
import {
  emitExit,
  localEnvironment,
  localPlan,
  localPort,
  requireInstalled,
  requireLocalProfile,
  selectedProject,
  type OperationalCommandContext,
  type OperationalExecution,
} from './operational-shared.js';

interface DevCommandOptions {
  environment: string;
  dryRun?: boolean;
  port: string;
  configFile?: string;
}

export function registerDevCommand(
  program: Command,
  context: OperationalCommandContext,
  execution: OperationalExecution,
  environment: () => NodeJS.ProcessEnv,
): void {
  program
    .command('dev')
    .description('Delegate one owned project-local Nest development process')
    .option('--environment <environment>', 'development or test', 'development')
    .option('--port <port>', 'Explicit API loopback port', '3100')
    .option(
      '--config-file <file>',
      'Explicit owner-only private API configuration file',
    )
    .option('--dry-run', 'Preview without writes, processes or probes')
    .action(async (options: DevCommandOptions) => {
      const operation = 'dev';
      context.setOperation(operation);
      const selectedEnvironment = localEnvironment(options.environment),
        selectedPort = localPort(options.port);
      if (context.json() && !options.dryRun)
        throw new CliError(
          'JSON_DEV_REQUIRES_DRY_RUN',
          'Use --json --dry-run for a portable preview, or run dev without --json to stream the owned compiler.',
        );
      const root = context.project(),
        state = await selectedProject(root),
        plan = localPlan(state.config, selectedEnvironment);
      requireLocalProfile(state.lock, selectedEnvironment);
      const runtimeEnvironment = options.dryRun ? {} : environment();
      let envFile = options.configFile
        ? path.resolve(root, options.configFile)
        : undefined;
      if (!options.dryRun) {
        requireInstalled(state.outcomes);
        if (!envFile && !runtimeEnvironment.APP_ENV_FILE) {
          const localFile = path.join(root, `.env.${selectedEnvironment}`);
          if (await statOrNull(localFile)) envFile = localFile;
        }
      }
      if (!options.dryRun && !envFile && !runtimeEnvironment.APP_ENV_FILE) {
        const api = plan.services.find((service) => service.kind === 'api');
        const missing = api?.environment
          .filter((field) => field.required && !runtimeEnvironment[field.key])
          .map((field) => field.key);
        if (missing?.length)
          throw new CliError(
            'DEV_CONFIG_REQUIRED',
            `Set ${missing.join(', ')} in the environment or select a private file with --config-file. For make dev, use .env.${selectedEnvironment} or CONFIG_FILE.`,
          );
      }
      const result = await executeDevCommand(
        {
          root,
          plan,
          port: selectedPort,
          environment: runtimeEnvironment,
          ...(envFile ? { envFile } : {}),
          dryRun: !!options.dryRun,
        },
        execution.devRunner,
      );
      const data = {
        project: plan.project,
        environment: plan.environment,
        port: selectedPort,
        outcomes: state.outcomes,
        command: 'node',
        args: ['node_modules/@nestjs/cli/bin/nest.js', 'start', '--watch'],
      };
      if (result.status === 'planned')
        context.emit({ schemaVersion: 1, status: 'preview', operation, data });
      else
        emitExit(context, operation, data, {
          code: result.code ?? 1,
          stdout: '',
        });
    });
}

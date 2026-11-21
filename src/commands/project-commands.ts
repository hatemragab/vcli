import type { Command } from 'commander';
import {
  checkProject,
  doctorProject,
  inspectProject,
  installProject,
} from '../engine/index.js';
import { recipeCatalog } from '../recipes/catalog.js';
import { recipeGuide } from '../recipes/catalog-guide.js';
import { packageRunner } from './package-runner.js';
import { checkSelectedConfig } from './config-check.js';
import { explainPath } from './explain-path.js';
import { queryLogs } from './log-query.js';
import type { CliRuntime } from './command-context.js';

export function registerProjectCommands(
  program: Command,
  runtime: CliRuntime,
  environment: () => NodeJS.ProcessEnv,
): void {
  program
    .command('catalog')
    .description('List bundled recipe choices, defaults and command examples')
    .action(
      runtime.run('catalog', async () => ({
        schemaVersion: 1,
        status: 'completed',
        operation: 'catalog',
        data: recipeCatalog.recipes.map((recipe) => ({
          id: recipe.id,
          version: recipe.version,
          family: recipe.family,
          requires: recipe.requires,
          conflicts: recipe.conflicts,
          ...recipeGuide(recipe.id),
        })),
      })),
    );
  program
    .command('inspect')
    .description(
      'Read realized choices and separate source/install/check state',
    )
    .action(
      runtime.run('inspect', async () => ({
        schemaVersion: 1,
        status: 'completed',
        operation: 'inspect',
        data: await inspectProject(runtime.project()),
      })),
    );
  program
    .command('doctor')
    .description('Diagnose local state without installing or probing providers')
    .action(
      runtime.run('doctor', async () => {
        const data = await doctorProject(runtime.project());
        return {
          schemaVersion: 1,
          status: data.issues.length ? 'failed' : 'completed',
          operation: 'doctor',
          data,
        };
      }),
    );
  program
    .command('install')
    .description(
      'Install selected declared dependencies; source is a separate outcome',
    )
    .option('--offline', 'Use only cached dependencies')
    .action(async (options: { offline?: boolean }) => {
      runtime.setOperation('install');
      const data = await installProject(runtime.project(), {
        runner: packageRunner(!!options.offline),
      });
      runtime.emit({
        schemaVersion: 1,
        status: data.outcomes.install === 'completed' ? 'completed' : 'failed',
        operation: 'install',
        data,
      });
    });
  program
    .command('check')
    .description(
      'Run declared generated-project checks and record actual outcomes',
    )
    .option(
      '--only <name>',
      'Run one declared check without changing the recorded full-check outcome',
    )
    .action(async (options: { only?: string }) => {
      runtime.setOperation('check');
      const data = await checkProject(runtime.project(), {
        runner: packageRunner(false),
        ...(options.only ? { only: options.only } : {}),
      });
      runtime.emit({
        schemaVersion: 1,
        status:
          options.only || data.outcomes.checks === 'completed'
            ? 'completed'
            : 'failed',
        operation: 'check',
        data,
      });
    });
  program
    .command('config')
    .description('Check the selected configuration without starting the app')
    .command('check')
    .option('--config-file <file>', 'Owner-only private configuration file')
    .option('--dry-run', 'List required names without reading the private file')
    .action(async (options: { configFile?: string; dryRun?: boolean }) => {
      runtime.setOperation('config.check');
      const data = await checkSelectedConfig(runtime.project(), options);
      runtime.emit({
        schemaVersion: 1,
        status:
          data.status === 'valid' || data.status === 'not-run'
            ? 'completed'
            : 'failed',
        operation: 'config.check',
        data,
      });
    });
  program
    .command('explain <path>')
    .description('Show the owner, template and focused check for one path')
    .action(async (relative: string) => {
      runtime.setOperation('explain');
      runtime.emit({
        schemaVersion: 1,
        status: 'completed',
        operation: 'explain',
        data: await explainPath(runtime.project(), relative),
      });
    });
  const logs = program
    .command('logs')
    .description('Query retained local diagnostics by request or operation id');
  const logAction =
    (action: 'status' | 'query') =>
    async (options: {
      requestId?: string;
      operationId?: string;
      configFile?: string;
      dryRun?: boolean;
    }) => {
      runtime.setOperation('logs.' + action);
      const data = await queryLogs(runtime.project(), {
        action,
        ...options,
        environment: options.dryRun ? {} : environment(),
      });
      runtime.emit({
        schemaVersion: 1,
        status: data.status === 'failed' ? 'failed' : 'completed',
        operation: 'logs.' + action,
        data,
      });
    };
  logs
    .command('status')
    .option('--config-file <file>', 'Owner-only private configuration file')
    .option('--dry-run', 'Preview without reading evidence')
    .action(logAction('status'));
  logs
    .command('query')
    .option('--request-id <id>', 'Request id from X-Request-Id')
    .option('--operation-id <id>', 'Operation id recorded with the request')
    .option('--config-file <file>', 'Owner-only private configuration file')
    .option('--dry-run', 'Preview without reading evidence')
    .action(logAction('query'));
}

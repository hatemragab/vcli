import type { Command } from 'commander';
import { recoverOperation } from '../engine/index.js';
import {
  getSupportCatalog,
  inspectMaintenance,
  planMaintenanceUpgrade,
  reportAdvisories,
  summarizeMaintenancePlan,
} from '../maintenance/index.js';
import {
  applyGeneration,
  type ApplyCommandOptions,
} from './generation-workflows.js';
import { applyOptions } from './command-options.js';
import { CliError } from './cli-error.js';
import type { CliRuntime } from './command-context.js';

export function registerMaintenanceCommands(
  program: Command,
  runtime: CliRuntime,
): void {
  program
    .command('support')
    .description(
      'Read the finite private release and migration support catalog',
    )
    .action(
      runtime.run('support', async () => ({
        schemaVersion: 1,
        status: 'completed',
        operation: 'support',
        data: getSupportCatalog(),
      })),
    );
  program
    .command('inventory')
    .description(
      'Inspect known runtime and copied components without reading private configuration',
    )
    .action(
      runtime.run('inventory', async () => ({
        schemaVersion: 1,
        status: 'completed',
        operation: 'inventory',
        data: await inspectMaintenance(runtime.project()),
      })),
    );
  program
    .command('advisories')
    .description(
      'Report curated demonstration advisories and explicit unknown source',
    )
    .action(
      runtime.run('advisories', async () => ({
        schemaVersion: 1,
        status: 'completed',
        operation: 'advisories',
        data: reportAdvisories(await inspectMaintenance(runtime.project())),
      })),
    );
  const upgrade = applyOptions(
    program
      .command('upgrade')
      .description(
        'Plan/apply supported managed updates; no database conversion',
      ),
  ).option(
    '--to <version>',
    'Exact coordinated toolkit version',
    runtime.manifestVersion,
  );
  upgrade.action(async (options: ApplyCommandOptions & { to: string }) => {
    runtime.setOperation('upgrade');
    if (options.to !== runtime.manifestVersion)
      throw new CliError(
        'UNSUPPORTED_RELEASE',
        'Install a reviewed target CLI release before planning that exact upgrade.',
      );
    const maintenance = await planMaintenanceUpgrade({
      projectDir: runtime.project(),
      targetVersion: options.to,
      catalog: runtime.catalog,
    });
    const result = await applyGeneration(maintenance.plan, options);
    runtime.emit({
      ...result,
      data: {
        generation: result.data,
        maintenance: summarizeMaintenancePlan(maintenance),
      },
    });
  });
  program
    .command('recover')
    .description(
      'Recover matching operation writes while preserving later edits',
    )
    .option('--operation <id>', 'Operation identifier')
    .option('--abandon-lock', 'Recover a provably inactive operation lock')
    .action(async (options: { operation?: string; abandonLock?: boolean }) => {
      runtime.setOperation('recover');
      const data = await recoverOperation(runtime.project(), {
        operationId: options.operation,
        abandonLock: options.abandonLock,
      });
      runtime.emit({
        schemaVersion: 1,
        status: data.status === 'recovered' ? 'completed' : 'failed',
        operation: 'recover',
        data,
      });
    });
}

import type { Command } from 'commander';
import { registerDevCommand } from './dev-commands.js';
import { registerReleaseCommands } from './release-commands.js';
import { registerServicesCommands } from './services-commands.js';
import type {
  OperationalCommandContext,
  OperationalExecution,
} from './operational-shared.js';

export type { OperationalCommandContext, OperationalExecution };

export function registerOperationalCommands(
  program: Command,
  context: OperationalCommandContext,
  execution: OperationalExecution = {},
): void {
  const environment = execution.environment ?? (() => ({ ...process.env }));
  registerServicesCommands(program, context, execution, environment);
  registerDevCommand(program, context, execution, environment);
  registerReleaseCommands(program, context, execution, environment);
}

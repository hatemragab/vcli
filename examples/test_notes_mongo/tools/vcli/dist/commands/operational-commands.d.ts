import type { Command } from 'commander';
import type { OperationalCommandContext, OperationalExecution } from './operational-shared.js';
export type { OperationalCommandContext, OperationalExecution };
export declare function registerOperationalCommands(program: Command, context: OperationalCommandContext, execution?: OperationalExecution): void;

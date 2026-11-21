import type { Command } from 'commander';
import { type OperationalCommandContext, type OperationalExecution } from './operational-shared.js';
export declare function registerReleaseCommands(program: Command, context: OperationalCommandContext, execution: OperationalExecution, environment: () => NodeJS.ProcessEnv): void;

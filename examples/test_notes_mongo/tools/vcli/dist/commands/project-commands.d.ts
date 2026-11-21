import type { Command } from 'commander';
import type { CliRuntime } from './command-context.js';
export declare function registerProjectCommands(program: Command, runtime: CliRuntime, environment: () => NodeJS.ProcessEnv): void;

import type { Command } from 'commander';
import type { CommandResult } from './command-output.js';
export interface DeploymentCommandContext {
    project(): string;
    emit(result: CommandResult): void;
    setOperation(name: string): void;
}
export declare function registerDeploymentCommands(program: Command, context: DeploymentCommandContext): void;

import { type RecipeCatalog } from '../contracts.js';
import type { GenerationPlan } from '../engine/types.js';
import type { CommandResult } from './command-output.js';
import { type SelectionOptions } from './selection-options.js';
export interface ApplyCommandOptions {
    dryRun?: boolean;
    savePlan?: string;
    skipInstall?: boolean;
    offline?: boolean;
    check?: boolean;
}
export interface InitCommandOptions extends SelectionOptions, ApplyCommandOptions {
    name?: string;
    yes?: boolean;
    preset?: string;
}
export declare function initWorkflow(catalog: RecipeCatalog, directory: string | undefined, options: InitCommandOptions, interactive: boolean): Promise<CommandResult>;
export declare function applyGeneration(plan: GenerationPlan, options: ApplyCommandOptions): Promise<CommandResult>;

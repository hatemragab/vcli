import type { RecipeCatalog } from '../contracts.js';
import type { CommandResult } from './command-output.js';
export interface CliRuntime {
    catalog: RecipeCatalog;
    project(): string;
    emit(result: CommandResult): void;
    run(name: string, action: () => Promise<CommandResult>): () => Promise<void>;
    setOperation(name: string): void;
    manifestVersion: string;
    interactive: boolean;
}

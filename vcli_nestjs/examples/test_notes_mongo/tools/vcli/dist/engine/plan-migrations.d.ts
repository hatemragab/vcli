import type { RenderedFile } from '../contracts.js';
import type { readProject } from './state.js';
import type { GenerationPlan, ProjectLock } from './types.js';
export declare function applySourceMigrationsToPlan(options: {
    projectDir: string;
    kind: GenerationPlan['kind'];
    previous?: Awaited<ReturnType<typeof readProject>>;
    sourceMigrations?: readonly string[];
    plan: GenerationPlan;
    lock: ProjectLock;
    recordChange: (file: RenderedFile, content: string) => Promise<void>;
}): Promise<void>;

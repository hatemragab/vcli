import type { GenerationPlan } from './types.js';
/** Validates every serialized path and metadata before even creating an operation lock. */
export declare function validatePlan(input: unknown): GenerationPlan;
export declare function savePlan(input: GenerationPlan, file: string): Promise<void>;
export declare function readPlan(file: string): Promise<GenerationPlan>;

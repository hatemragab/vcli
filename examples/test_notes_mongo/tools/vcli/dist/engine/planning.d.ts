import type { GenerationPlan, PlanAddOptions, PlanInitOptions, PlanScaffoldOptions, PlanSummary, PlanUpgradeOptions } from './types.js';
export declare function planInit(options: PlanInitOptions): Promise<GenerationPlan>;
export declare function planAdd(options: PlanAddOptions): Promise<GenerationPlan>;
export declare function planScaffold(options: PlanScaffoldOptions): Promise<GenerationPlan>;
/** Exact curated release edges reuse the source lifecycle; provider changes and arbitrary codemods are excluded. */
export declare function planUpgrade(options: PlanUpgradeOptions): Promise<GenerationPlan>;
export declare function summarizePlan(plan: GenerationPlan): PlanSummary;

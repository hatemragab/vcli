import type { DeploymentJournal, DeploymentStep } from './types.js';

export interface DeploymentSummary {
  planId: string;
  operationId: string;
  resourceId?: string;
  disposition: 'created' | 'reused';
  outcome:
    'pending' | 'partial' | 'unknown' | 'applied-unverified' | 'verified';
  steps: {
    name: DeploymentStep;
    state: 'pending' | 'incomplete' | 'unknown' | 'completed';
  }[];
}
export function summarizeDeployment(
  journal: DeploymentJournal,
): DeploymentSummary {
  return {
    planId: journal.planId,
    operationId: journal.operationId,
    ...(journal.resourceId ? { resourceId: journal.resourceId } : {}),
    disposition: journal.disposition,
    outcome: journal.verified
      ? 'verified'
      : journal.steps.some(
            (s) => s.state === 'unknown' || s.state === 'incomplete',
          )
        ? 'unknown'
        : journal.steps.every((s) => s.state === 'completed')
          ? 'applied-unverified'
          : journal.steps.some((s) => s.state === 'completed')
            ? 'partial'
            : 'pending',
    steps: journal.steps.map((s) => ({ name: s.name, state: s.state })),
  };
}

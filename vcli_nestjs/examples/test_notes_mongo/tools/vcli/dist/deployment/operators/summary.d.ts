import type { DeploymentJournal, DeploymentStep } from './types.js';
export interface DeploymentSummary {
    planId: string;
    operationId: string;
    resourceId?: string;
    disposition: 'created' | 'reused';
    outcome: 'pending' | 'partial' | 'unknown' | 'applied-unverified' | 'verified';
    steps: {
        name: DeploymentStep;
        state: 'pending' | 'incomplete' | 'unknown' | 'completed';
    }[];
}
export declare function summarizeDeployment(journal: DeploymentJournal): DeploymentSummary;

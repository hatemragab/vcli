export function summarizeDeployment(journal) {
    return {
        planId: journal.planId,
        operationId: journal.operationId,
        ...(journal.resourceId ? { resourceId: journal.resourceId } : {}),
        disposition: journal.disposition,
        outcome: journal.verified
            ? 'verified'
            : journal.steps.some((s) => s.state === 'unknown' || s.state === 'incomplete')
                ? 'unknown'
                : journal.steps.every((s) => s.state === 'completed')
                    ? 'applied-unverified'
                    : journal.steps.some((s) => s.state === 'completed')
                        ? 'partial'
                        : 'pending',
        steps: journal.steps.map((s) => ({ name: s.name, state: s.state })),
    };
}
//# sourceMappingURL=summary.js.map
import { join } from 'node:path';
import { z } from 'zod';
import { CaproverOperator } from './caprover-operator.js';
import { CoolifyOperator } from './coolify-operator.js';
import { DokployOperator } from './dokploy-operator.js';
import { DeploymentOperatorError } from './deployment-operator-error.js';
import { parseDeploymentSnapshot } from './input-schemas.js';
import { assertPlan } from './plan.js';
import { readOptional, releaseLock } from './private-files.js';
import { summarizeDeployment } from './summary.js';
import { assertReplacement, digest, fail, idSchema, refSchema, same, validateProfile, } from './validation.js';
export function nativeDriver(input, options = {}) {
    const profile = validateProfile(input);
    const driver = profile.target === 'dokploy'
        ? new DokployOperator(profile, options)
        : profile.target === 'coolify'
            ? new CoolifyOperator(profile, options)
            : new CaproverOperator(profile, options);
    return {
        discover: async () => parseDeploymentSnapshot(await driver.discover()),
        mutate: (...args) => driver.mutate(...args),
        verify: (...args) => driver.verify(...args),
    };
}
export function safeError(error, journal) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]{1,95}$/.test(error.message)
        ? error.message
        : 'DEPLOYMENT_OPERATION_FAILED';
    return new DeploymentOperatorError(code, journal ? summarizeDeployment(journal) : undefined);
}
export async function safeUnlock(path, id, journal) {
    try {
        await releaseLock(path, id);
    }
    catch (error) {
        throw safeError(error, journal);
    }
}
export function boundProfile(plan, input) {
    assertPlan(plan);
    const profile = validateProfile(input);
    if (profile.target !== plan.snapshot.target ||
        profile.targetVersion !== plan.snapshot.targetVersion ||
        profile.origin !== plan.snapshot.origin ||
        !same(profile.scope, plan.snapshot.scope))
        fail('DEPLOYMENT_SCOPE_MISMATCH');
    if (!same(Object.keys(profile.environment).sort(), [...plan.release.managedEnvironmentKeys].sort()))
        fail('PRIVATE_MANAGED_ENVIRONMENT_MISMATCH');
    if (profile.exclusive.evidenceRef !== plan.release.preconditions.exclusiveRef ||
        profile.exclusive.secretRevisionRef !==
            plan.release.preconditions.secretRevisionRef)
        fail('EXPLICIT_EXCLUSIVE_RECONCILIATION_REQUIRED');
    for (const [key, expected] of Object.entries({
        PORT: '3100',
        HOST: '0.0.0.0',
        NODE_ENV: plan.services.nodeEnvironment,
        LOCAL_STORAGE_ROOT: '/app/var/storage',
        EVIDENCE_DIRECTORY: '/app/var/evidence',
    }))
        if (Object.hasOwn(profile.environment, key) &&
            profile.environment[key] !== expected)
            fail('RUNTIME_SETTINGS_CONFLICT');
    assertReplacement(profile, plan.snapshot.resources[0]?.environmentKeys ?? []);
    return profile;
}
export function operatorPaths(plan, p) {
    const target = digest({
        origin: p.origin,
        target: p.target,
        scope: { ...p.scope, resourceId: undefined },
    });
    return {
        journal: join(p.journalDirectory, plan.id + '.json'),
        lock: join(p.journalDirectory, target + '.lock'),
        binding: join(p.journalDirectory, target + '.binding'),
    };
}
const stepSchema = z.enum([
    'create',
    'configure',
    'environment',
    'domain',
    'ssl',
    'deploy',
]);
export const journalSchema = z
    .object({
    schemaVersion: z.literal(1),
    planId: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: z.uuid(),
    resourceId: idSchema.optional(),
    disposition: z.enum(['created', 'reused']),
    steps: z
        .array(z
        .object({
        name: stepSchema,
        state: z.enum(['pending', 'incomplete', 'unknown', 'completed']),
    })
        .strict())
        .max(6),
    checkpoint: z.custom((v) => !!v && typeof v === 'object'),
    verified: z.boolean(),
    decisions: z
        .array(z
        .object({
        step: stepSchema,
        decision: z.enum(['completed', 'retry']),
        evidenceRef: refSchema,
    })
        .strict())
        .max(256),
})
    .strict();
export async function loadJournal(path, plan) {
    const value = await readOptional(path);
    if (value === undefined)
        return undefined;
    const parsed = journalSchema.safeParse(value);
    if (!parsed.success)
        fail('INVALID_DEPLOYMENT_JOURNAL');
    const journal = parsed.data;
    if (journal.planId !== plan.id ||
        journal.operationId !== plan.release.operationId ||
        !same(journal.steps.map((s) => s.name), plan.steps) ||
        !same(journal.checkpoint.scope, plan.snapshot.scope) ||
        journal.checkpoint.origin !== plan.snapshot.origin ||
        journal.checkpoint.target !== plan.snapshot.target)
        fail('INVALID_DEPLOYMENT_JOURNAL');
    return {
        ...journal,
        checkpoint: parseDeploymentSnapshot(journal.checkpoint),
    };
}
export function newJournal(plan) {
    const resourceId = plan.snapshot.resources[0]?.id;
    return {
        schemaVersion: 1,
        planId: plan.id,
        operationId: plan.release.operationId,
        ...(resourceId ? { resourceId } : {}),
        disposition: resourceId ? 'reused' : 'created',
        steps: plan.steps.map((name) => ({ name, state: 'pending' })),
        checkpoint: plan.snapshot,
        verified: false,
        decisions: [],
    };
}
export function findCreated(plan, current) {
    if (current.resources.length > 1)
        fail('AMBIGUOUS_RESOURCE_DISCOVERY');
    const r = current.resources[0];
    if (!r)
        return undefined;
    if (r.operationId !== plan.release.operationId &&
        !(plan.services.target === 'caprover' &&
            r.id === plan.snapshot.scope.appName))
        fail('UNPROVEN_CREATED_RESOURCE');
    return r.id;
}
//# sourceMappingURL=operator-journal.js.map
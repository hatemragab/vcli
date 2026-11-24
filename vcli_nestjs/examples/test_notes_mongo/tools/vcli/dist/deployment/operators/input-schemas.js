import { z } from 'zod';
import { projectNameSchema } from '../../contracts.js';
import { commitSchema, digest, fail, idSchema, imageSchema, keySchema, refSchema, scopeSchema, versions, httpsUrl, } from './validation.js';
const text = z.string().max(4096);
const technicalPath = z
    .string()
    .max(256)
    .regex(/^\/[a-zA-Z0-9_.@/-]*$/);
const host = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const field = z
    .object({
    key: keySchema,
    required: z.boolean(),
    secret: z.boolean(),
    defaultValue: text.optional(),
})
    .strict()
    .refine((f) => !(f.secret && f.defaultValue !== undefined));
const resourceId = z.enum([
    'database',
    'storage',
    'firebase',
    'smtp',
    'http-mail',
    'fcm',
    'apns',
    'centrifugo',
    'redis',
    'diagnostic-reader',
]);
const service = z
    .object({
    id: idSchema,
    kind: z.enum(['api', 'database', 'realtime', 'diagnostics', 'redis']),
    execution: z.enum(['project', 'compose', 'external', 'native']),
    resourceRef: idSchema,
    image: text.optional(),
    command: z.array(text).max(16),
    ports: z
        .array(z
        .object({
        port: z.number().int().min(1).max(65535),
        visibility: z.enum(['loopback', 'private', 'public-ingress']),
        purpose: text,
    })
        .strict())
        .max(16),
    dependsOn: z.array(idSchema).max(16),
    environment: z.array(field).max(256),
    resources: z
        .object({
        memoryMiB: z.number().positive().max(65536),
        cpus: z.number().positive().max(64),
        pids: z.number().int().positive().max(65536),
    })
        .strict(),
    health: z
        .object({
        scope: z.enum(['process', 'readiness', 'external']),
        check: text,
        applicationAcceptance: z.literal(false),
    })
        .strict(),
    volumes: z.array(idSchema).max(16),
})
    .strict();
const servicePlanSchema = z
    .object({
    schemaVersion: z.literal(1),
    project: projectNameSchema,
    environment: z.enum(['development', 'test', 'staging', 'production']),
    nodeEnvironment: z.enum(['development', 'test', 'production']),
    target: z.enum(['local', 'dokploy', 'coolify', 'caprover']),
    targetVersion: z.string().max(32),
    topology: z.enum(['single', 'cluster']),
    replicas: z.number().int().min(1).max(8),
    cgroupParent: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@/-]{0,127}$/)
        .optional(),
    services: z.array(service).max(16),
    volumes: z
        .array(z
        .object({
        id: idSchema,
        resourceRef: idSchema,
        containerPath: technicalPath,
        owner: z.enum(['node', 'database']),
        mode: z.literal('0700'),
        purpose: text,
        backup: z.enum(['required', 'reconstructible']),
    })
        .strict())
        .max(16),
    externalRequirements: z
        .array(z
        .object({
        id: resourceId,
        resourceRef: idSchema.optional(),
        environmentKeys: z.array(keySchema).max(256),
        requirement: text,
    })
        .strict())
        .max(16),
    jobs: z
        .array(z
        .object({
        id: z.enum(['release', 'mail-drain', 'identity-cleanup']),
        command: z.array(text).max(16),
        scheduler: z.literal('operator'),
        concurrency: z.enum(['database-lock', 'bounded-cas-lease']),
        restart: z.literal('no'),
        dependsOn: z.array(idSchema).max(16),
    })
        .strict())
        .max(3),
    ingress: z
        .array(z
        .object({
        service: idSchema,
        port: z.number().int().min(1).max(65535),
        path: technicalPath,
        websocket: z.boolean(),
        stickiness: z.literal('none-single-instance'),
        tls: z.literal('operator'),
        deniedApiPaths: z.array(technicalPath).max(32),
    })
        .strict())
        .max(8),
    operatorReview: z.array(keySchema).max(256),
    pending: z.array(text).max(64),
})
    .strict();
export function parseServicePlan(value) {
    const parsed = servicePlanSchema.safeParse(value);
    if (!parsed.success)
        fail('INVALID_SERVICE_PLAN');
    return parsed.data;
}
export const releaseSchema = z
    .object({
    operationId: z.uuid(),
    sourceCommit: commitSchema,
    image: imageSchema.optional(),
    source: z
        .object({
        repository: z.string().max(512),
        branch: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/),
    })
        .strict()
        .optional(),
    schemaReleaseId: idSchema.optional(),
    readinessUrl: z.string().max(512),
    managedEnvironmentKeys: z.array(keySchema).max(256),
    preconditions: z
        .object({
        exclusiveRef: refSchema,
        secretRevisionRef: refSchema,
        ingressRef: refSchema,
        externalResources: z.record(idSchema, refSchema),
        volumes: z.record(idSchema, refSchema),
        nodeId: idSchema.optional(),
    })
        .strict(),
})
    .strict();
export function parseReleaseFacts(value) {
    const parsed = releaseSchema.safeParse(value);
    if (!parsed.success)
        fail('INVALID_RELEASE_FACTS');
    httpsUrl(parsed.data.readinessUrl);
    if (parsed.data.source)
        httpsUrl(parsed.data.source.repository);
    return parsed.data;
}
const dokploySettings = z
    .object({
    appName: idSchema.nullable(),
    sourceType: z.enum(['raw']).nullable(),
    composeType: z.literal('docker-compose').nullable(),
    composePath: z
        .string()
        .regex(/^[a-zA-Z0-9._/-]{1,256}$/)
        .nullable(),
    autoDeploy: z.boolean().nullable(),
    composeFingerprint: fingerprint.nullable(),
    volumeBindings: z
        .array(z
        .object({
        resourceRef: idSchema,
        containerPath: z.enum(['/app/var/storage', '/app/var/evidence']),
    })
        .strict())
        .max(2),
    domains: z
        .array(z
        .object({
        id: idSchema,
        host: host.nullable(),
        port: z.number().int().min(1).max(65535).nullable(),
        path: technicalPath.nullable(),
        https: z.boolean().nullable(),
        serviceName: idSchema.nullable(),
        certificateType: z
            .enum(['letsencrypt', 'none', 'custom'])
            .nullable(),
        enabled: z.boolean().nullable(),
        domainType: z
            .enum(['compose', 'application', 'preview'])
            .nullable(),
    })
        .strict())
        .max(64),
})
    .strict();
const coolifySettings = z
    .object({
    git_repository: z
        .string()
        .max(512)
        .refine((value) => {
        if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value))
            return true;
        try {
            const u = new URL(value);
            return (u.protocol === 'https:' &&
                !u.username &&
                !u.password &&
                !u.search &&
                !u.hash);
        }
        catch {
            return false;
        }
    })
        .nullable(),
    git_branch: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/)
        .nullable(),
    git_commit_sha: commitSchema.nullable(),
    build_pack: z.literal('dockercompose').nullable(),
    base_directory: technicalPath.nullable(),
    docker_compose_location: technicalPath.nullable(),
    ports_exposes: z
        .string()
        .regex(/^\d{1,5}(?:,\d{1,5})*$/)
        .nullable(),
    health_check_enabled: z.boolean().nullable(),
    health_check_path: technicalPath.nullable(),
    health_check_port: z
        .union([
        z.string().regex(/^\d{1,5}$/),
        z.number().int().min(1).max(65535),
    ])
        .nullable(),
    limits_memory: z
        .string()
        .regex(/^\d+(?:[kKmMgG])?$/)
        .nullable(),
    limits_cpus: z
        .union([z.string().regex(/^\d+(?:\.\d+)?$/), z.number().nonnegative()])
        .nullable(),
    volumeBindings: z
        .array(z
        .object({
        resourceRef: idSchema,
        containerPath: z.enum(['/app/var/storage', '/app/var/evidence']),
        nativeId: idSchema,
    })
        .strict())
        .max(2),
    inject_build_args_to_dockerfile: z.boolean().nullable(),
    redact_all_env_values_in_logs: z.boolean().nullable(),
    include_coolify_default_variables: z.boolean().nullable(),
    domains: z
        .string()
        .max(4096)
        .refine((value) => /^\{"api":\{"domain":"https:\/\/[a-z0-9.-]+:3100"\}\}$/.test(value) ||
        value === '{}')
        .nullable(),
    is_auto_deploy_enabled: z.boolean().nullable(),
    is_preview_deployments_enabled: z.boolean().nullable(),
    is_force_https_enabled: z.boolean().nullable(),
})
    .strict();
const caproverSettings = z
    .object({
    projectId: idSchema.nullable(),
    instanceCount: z.number().int().min(0).max(8).nullable(),
    containerHttpPort: z.number().int().min(1).max(65535).nullable(),
    hasPersistentData: z.boolean().nullable(),
    notExposeAsWebApp: z.boolean().nullable(),
    forceSsl: z.boolean().nullable(),
    websocketSupport: z.boolean().nullable(),
    nodeId: z.union([idSchema, z.literal('')]).nullable(),
    hasDefaultSubDomainSsl: z.boolean().nullable(),
    volumes: z
        .array(z
        .object({
        volumeName: idSchema,
        containerPath: z.enum(['/app/var/storage', '/app/var/evidence']),
        mode: z.enum(['rw', 'ro']),
    })
        .strict())
        .max(2),
    domains: z
        .array(z.object({ publicDomain: host, hasSsl: z.boolean() }).strict())
        .max(64),
    ports: z
        .array(z
        .object({
        hostPort: z.number().int().min(1).max(65535),
        containerPort: z.number().int().min(1).max(65535),
    })
        .strict())
        .max(32),
    resourceLimits: z.boolean(),
    rootDomain: host,
})
    .strict();
const resourceSnapshot = z
    .object({
    id: idSchema,
    name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    operationId: z.uuid().nullable(),
    settings: z.unknown(),
    environmentKeys: z.array(keySchema).max(256),
})
    .strict();
const snapshotSchema = z
    .object({
    schemaVersion: z.literal(1),
    target: z.enum(['dokploy', 'coolify', 'caprover']),
    targetVersion: z.string().max(32),
    origin: z.string().max(512),
    scope: scopeSchema,
    resources: z.array(resourceSnapshot).max(64),
    fingerprint,
})
    .strict();
export function parseDeploymentSnapshot(value) {
    const parsed = snapshotSchema.safeParse(value);
    if (!parsed.success)
        fail('INVALID_DEPLOYMENT_SNAPSHOT');
    const data = parsed.data;
    if (data.targetVersion !== versions[data.target])
        fail('UNSUPPORTED_TARGET_VERSION');
    httpsUrl(data.origin, true);
    const resources = data.resources.map((r) => {
        const validated = {
            dokploy: dokploySettings,
            coolify: coolifySettings,
            caprover: caproverSettings,
        }[data.target].safeParse(r.settings);
        if (!validated.success ||
            new Set(r.environmentKeys).size !== r.environmentKeys.length)
            fail('INVALID_SNAPSHOT_SETTINGS');
        return { ...r, settings: validated.data };
    });
    const result = { ...data, resources };
    const { fingerprint: expected, ...body } = result;
    if (digest(body) !== expected)
        fail('INVALID_SNAPSHOT');
    return result;
}
export const decisionSchema = z
    .object({
    quiesced: z.literal(true),
    expectedPlanId: fingerprint,
    expectedStep: z.enum([
        'create',
        'configure',
        'environment',
        'domain',
        'ssl',
        'deploy',
    ]),
    expectedFingerprint: fingerprint,
    expectedLockId: z.uuid().optional(),
    decision: z.enum(['completed', 'retry']),
    evidenceRef: refSchema,
})
    .strict();
export function parseReconciliationDecision(value) {
    const parsed = decisionSchema.safeParse(value);
    if (!parsed.success)
        fail('INVALID_RECONCILIATION_DECISION');
    return parsed.data;
}
//# sourceMappingURL=input-schemas.js.map
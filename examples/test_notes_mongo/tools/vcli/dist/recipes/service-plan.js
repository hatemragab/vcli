import { createHash } from 'node:crypto';
import { projectNameSchema, validationFailure, } from '../contracts.js';
import { selection } from './selection.js';
import { contributeDatabaseService, contributeProviderExternalsAndJobs, contributeRealtimeAndIngress, contributeStorageAndDiagnostics, serviceImages, } from './service-plan-contributions.js';
export { serviceImages };
/** Artifact contracts reviewed against official docs, not live platform acceptance. */
export const targetContracts = Object.freeze({
    local: 'compose-v2',
    dokploy: '0.31.3',
    coolify: '4.7.5',
    caprover: '1.16.0',
});
const production = (environment) => environment === 'staging' || environment === 'production';
/** Retain full project metadata while bounding native resource identifiers to 63 characters. */
export function serviceResourceName(project, suffix) {
    if (!projectNameSchema.safeParse(project).success)
        throw new Error('INVALID_SERVICE_PROJECT');
    if (!/^[a-z][a-z0-9-]*$/.test(suffix))
        throw new Error('INVALID_SERVICE_RESOURCE_SUFFIX');
    const original = project + '-' + suffix;
    const normalized = original.replace(/[._]/g, '-');
    if (normalized === original && normalized.length <= 63)
        return normalized;
    return (normalized.slice(0, 46).replace(/-+$/, '') +
        '-' +
        createHash('sha256').update(original).digest('hex').slice(0, 16));
}
function normalizedEnvironment(config, fields) {
    const sdkFields = [
        { key: 'APP_ENV_FILE', required: false, secret: true },
    ];
    if (selection(config, 'auth') === 'auth.firebase' ||
        selection(config, 'push-fcm'))
        sdkFields.push({
            key: 'GOOGLE_APPLICATION_CREDENTIALS',
            required: false,
            secret: true,
        });
    if (['storage.aws-s3', 'storage.r2'].includes(selection(config, 'storage') ?? ''))
        for (const key of [
            'AWS_ACCESS_KEY_ID',
            'AWS_SECRET_ACCESS_KEY',
            'AWS_SESSION_TOKEN',
            'AWS_SHARED_CREDENTIALS_FILE',
            'AWS_PROFILE',
        ])
            sdkFields.push({ key, required: false, secret: true });
    const env = [
        ...fields,
        ...sdkFields.filter((field) => !fields.some((existing) => existing.key === field.key)),
    ]
        .map((field) => {
        if (!/^[A-Z][A-Z0-9_]*$/.test(field.key) ||
            typeof field.required !== 'boolean' ||
            typeof field.secret !== 'boolean' ||
            (field.secret && field.defaultValue !== undefined))
            throw new Error('INVALID_SERVICE_ENVIRONMENT_FIELD');
        return {
            key: field.key,
            required: field.required,
            secret: field.secret,
            ...(field.defaultValue !== undefined
                ? { defaultValue: field.defaultValue }
                : {}),
        };
    })
        .sort((a, b) => a.key.localeCompare(b.key));
    if (new Set(env.map((field) => field.key)).size !== env.length)
        throw new Error('DUPLICATE_SERVICE_ENVIRONMENT_FIELD');
    return env;
}
/** Finite selected requirements. Pure: no environment, filesystem, process or network reads. */
export function describeServices(config, fields, options = {}) {
    serviceResourceName(config.project.name, 'validation');
    const targetId = selection(config, 'deployment');
    const target = targetId
        ? targetId.slice('deployment.'.length)
        : 'local';
    if (!Object.hasOwn(targetContracts, target))
        throw new Error('UNSUPPORTED_DEPLOYMENT_TARGET');
    const environment = options.environment ?? (target === 'local' ? 'development' : 'production');
    if (!['development', 'test', 'staging', 'production'].includes(environment))
        throw new Error('UNSUPPORTED_SERVICE_ENVIRONMENT');
    if (target !== 'local' && !production(environment))
        throw new Error('UNSUPPORTED_TARGET_ENVIRONMENT');
    if ((options.targetVersion ?? targetContracts[target]) !==
        targetContracts[target])
        throw new Error('UNSUPPORTED_TARGET_VERSION');
    const realtimeScale = config.capabilities.realtime?.options.scale ?? 'single-instance';
    if (!['single-instance', 'cluster'].includes(String(realtimeScale)))
        throw new Error('UNSUPPORTED_REALTIME_SCALE');
    const topology = options.topology ?? (realtimeScale === 'cluster' ? 'cluster' : 'single');
    const replicas = options.replicas ?? (topology === 'cluster' ? 2 : 1);
    if (!['single', 'cluster'].includes(topology) ||
        !Number.isInteger(replicas) ||
        replicas < 1 ||
        replicas > 8 ||
        (topology === 'single' && replicas !== 1) ||
        (topology === 'cluster' && replicas < 2))
        throw new Error('UNSUPPORTED_SERVICE_TOPOLOGY');
    if (selection(config, 'realtime') &&
        (topology === 'cluster') !== (realtimeScale === 'cluster'))
        throw new Error('REALTIME_TOPOLOGY_MISMATCH');
    if (topology === 'cluster' &&
        (selection(config, 'storage') ||
            selection(config, 'diagnostics') ||
            selection(config, 'realtime') === 'realtime.native-ws'))
        throw validationFailure('UNSUPPORTED_SERVICE_TOPOLOGY', 'Private transfer/evidence roots or native-ws require a single instance.');
    if (topology === 'cluster' && !selection(config, 'database'))
        throw new Error('CLUSTER_REQUIRES_SHARED_NATIVE_DATABASE');
    if (options.cgroupParent !== undefined &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_.@/-]{0,127}$/.test(options.cgroupParent))
        throw new Error('INVALID_CGROUP_PARENT');
    if (production(environment) && selection(config, 'mail') === 'mail.capture')
        throw new Error('UNSAFE_PRODUCTION_CAPTURE');
    const env = normalizedEnvironment(config, fields);
    const ctx = {
        config,
        target,
        environment,
        isProduction: production(environment),
        topology,
        env,
        options,
        ref: (id) => serviceResourceName(config.project.name, `${environment}-${id}`),
        services: [],
        external: [],
        volumes: [],
        jobs: [],
        ingress: [],
        pending: [
            'Artifact planning does not provision services, inject credentials, run release jobs, build images or prove readiness.',
        ],
    };
    if (topology === 'cluster')
        ctx.pending.push('Generation-only replicated profile: shared native DB and selected realtime adapter/engine required. Dokploy/Coolify standard Compose replicas share one Docker host; cross-host placement needs a separately reviewed native scheduler. CapRover placement uses its native Swarm. Multi-instance/native-target acceptance is pending.');
    contributeDatabaseService(ctx);
    contributeStorageAndDiagnostics(ctx);
    contributeProviderExternalsAndJobs(ctx);
    contributeRealtimeAndIngress(ctx);
    ctx.services.unshift({
        id: 'api',
        kind: 'api',
        execution: target === 'local'
            ? 'project'
            : target === 'caprover'
                ? 'native'
                : 'compose',
        resourceRef: ctx.ref('api'),
        image: serviceImages.node,
        command: ['node', 'dist/main.js'],
        ports: [
            {
                port: 3100,
                visibility: target === 'local' ? 'loopback' : 'public-ingress',
                purpose: 'HTTP liveness/readiness and selected public API',
            },
        ],
        dependsOn: selection(config, 'database') ? ['database'] : [],
        environment: env,
        resources: { memoryMiB: 512, cpus: 1, pids: 256 },
        health: {
            scope: 'readiness',
            check: 'GET /health/ready; liveness GET /health/live; not provider/end-to-end acceptance',
            applicationAcceptance: false,
        },
        volumes: ctx.volumes
            .filter((item) => item.owner === 'node')
            .map((item) => item.id),
    });
    const declared = new Set(ctx.external.map((item) => item.id));
    for (const [key, value] of Object.entries(options.externalResources ?? {}))
        if (!declared.has(key) ||
            typeof value !== 'string' ||
            !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value))
            throw new Error('UNDECLARED_OR_INVALID_EXTERNAL_RESOURCE');
    if (options.requireExternalResources &&
        ctx.external.some((item) => !item.resourceRef))
        throw new Error('MISSING_EXTERNAL_RESOURCE');
    for (const requirement of ctx.external)
        if (!requirement.resourceRef)
            ctx.pending.push(`Configure external resource: ${requirement.id}`);
    return {
        schemaVersion: 1,
        project: config.project.name,
        environment,
        nodeEnvironment: production(environment)
            ? 'production'
            : environment,
        target,
        targetVersion: targetContracts[target],
        topology,
        replicas,
        ...(options.cgroupParent ? { cgroupParent: options.cgroupParent } : {}),
        services: ctx.services,
        volumes: ctx.volumes,
        externalRequirements: ctx.external.sort((a, b) => a.id.localeCompare(b.id)),
        jobs: ctx.jobs,
        ingress: ctx.ingress,
        operatorReview: [
            'PUBLIC_ORIGIN',
            'ALLOWED_ORIGINS',
            ...(selection(config, 'mail') ? ['MAIL_FROM'] : []),
        ],
        pending: ctx.pending,
    };
}
//# sourceMappingURL=service-plan.js.map
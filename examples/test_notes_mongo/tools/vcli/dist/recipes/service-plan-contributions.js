import { selection } from './selection.js';
export const serviceImages = Object.freeze({
    node: 'node:26.13.1-bookworm-slim',
    mongodb: 'mongo:8.0.38',
    postgres: 'postgres:16.16-bookworm',
});
export function addExternalRequirement(ctx, id, keys, requirement) {
    ctx.external.push({
        id,
        ...(ctx.options.externalResources?.[id]
            ? { resourceRef: ctx.options.externalResources[id] }
            : {}),
        environmentKeys: keys,
        requirement,
    });
}
export function addNodeVolume(ctx, id, path, purpose) {
    ctx.volumes.push({
        id,
        resourceRef: ctx.ref(id),
        containerPath: path,
        owner: 'node',
        mode: '0700',
        purpose,
        backup: 'required',
    });
}
export function contributeDatabaseService(ctx) {
    const db = selection(ctx.config, 'database');
    if (ctx.config.capabilities.mail?.options.reliableActions === true && !db)
        throw new Error('RELIABLE_MAIL_REQUIRES_NATIVE_DATABASE');
    if (db && !['database.mongodb', 'database.postgres'].includes(db))
        throw new Error('UNSUPPORTED_SERVICE_DATABASE');
    if (!db)
        return;
    const local = ctx.target === 'local' && !ctx.isProduction && ctx.topology === 'single';
    ctx.services.push({
        id: 'database',
        kind: 'database',
        execution: local ? 'compose' : 'external',
        resourceRef: ctx.options.externalResources?.database ?? ctx.ref('database'),
        ...(local
            ? {
                image: db === 'database.mongodb'
                    ? serviceImages.mongodb
                    : serviceImages.postgres,
            }
            : {}),
        command: db === 'database.mongodb'
            ? ['mongod', '--replSet', 'rs0', '--bind_ip_all']
            : ['postgres'],
        ports: [
            {
                port: db === 'database.mongodb' ? 27017 : 5432,
                visibility: local ? 'loopback' : 'private',
                purpose: 'selected native transactional database',
            },
        ],
        dependsOn: [],
        environment: local
            ? [
                {
                    key: 'VCLI_DATABASE_PORT',
                    required: false,
                    secret: false,
                    defaultValue: db === 'database.mongodb' ? '27017' : '5432',
                },
                { key: 'VCLI_WORKSPACE_ID', required: true, secret: false },
                ...(db === 'database.postgres'
                    ? [
                        {
                            key: 'VCLI_POSTGRES_PASSWORD',
                            required: true,
                            secret: true,
                        },
                    ]
                    : []),
            ]
            : [],
        resources: { memoryMiB: 512, cpus: 1, pids: 128 },
        health: {
            scope: local ? 'process' : 'external',
            check: db === 'database.mongodb'
                ? 'Replica set initialized; primary writable and transaction topology checked separately'
                : 'pg_isready; schema/release history checked separately',
            applicationAcceptance: false,
        },
        volumes: local ? ['database-data'] : [],
    });
    if (local)
        ctx.volumes.push({
            id: 'database-data',
            resourceRef: ctx.ref('database-data'),
            containerPath: db === 'database.mongodb' ? '/data/db' : '/var/lib/postgresql/data',
            owner: 'database',
            mode: '0700',
            purpose: 'selected native database data, preserved on ordinary down',
            backup: 'required',
        });
    if (!local)
        addExternalRequirement(ctx, 'database', ['DATABASE_URL'], db === 'database.mongodb'
            ? 'Preprovision MongoDB replica set or sharded transactional topology; private TLS/credentials and native release permissions.'
            : 'Preprovision PostgreSQL with private TLS/credentials and native release permissions.');
    ctx.jobs.push({
        id: 'release',
        command: ['node', 'dist/initialize-database.js'],
        scheduler: 'operator',
        concurrency: 'database-lock',
        restart: 'no',
        dependsOn: ['database'],
    });
}
export function contributeStorageAndDiagnostics(ctx) {
    const { config } = ctx;
    if (selection(config, 'storage')) {
        addNodeVolume(ctx, 'app-storage', '/app/var/storage', 'private immutable local objects and/or bounded transfer staging; never served as a static directory');
        if (selection(config, 'storage') !== 'storage.local')
            addExternalRequirement(ctx, 'storage', [
                'S3_BUCKET',
                'S3_REGION',
                ...(selection(config, 'storage') === 'storage.r2'
                    ? ['S3_ENDPOINT']
                    : []),
            ], 'Preprovision selected AWS/R2 bucket and least-privilege workload credentials. Local staging still belongs to this single API node.');
    }
    if (selection(config, 'diagnostics')) {
        addNodeVolume(ctx, 'app-evidence', '/app/var/evidence', 'same-user retained evidence, one publisher per source root; no shared replica volume');
        const diagnosticOptions = config.capabilities.diagnostics.options;
        if (diagnosticOptions.vector || diagnosticOptions.logdy) {
            ctx.services.push({
                id: 'diagnostic-viewers',
                kind: 'diagnostics',
                execution: 'native',
                resourceRef: ctx.ref('diagnostic-viewers'),
                command: [],
                ports: diagnosticOptions.logdy
                    ? [
                        {
                            port: 58233,
                            visibility: 'loopback',
                            purpose: 'sanitized live Logdy feed',
                        },
                        {
                            port: 58080,
                            visibility: 'loopback',
                            purpose: 'private Logdy UI',
                        },
                    ]
                    : [],
                dependsOn: ['api'],
                environment: [],
                resources: { memoryMiB: 256, cpus: 0.5, pids: 128 },
                health: {
                    scope: 'external',
                    check: 'Native selected Vector/Logdy topology must be configured and accepted separately; not API readiness',
                    applicationAcceptance: false,
                },
                volumes: ['app-evidence'],
            });
            ctx.pending.push('Vector/Logdy remain separately invoked native tools; selected ops/diagnostics owns exact configuration. No container viewer, host-gateway feed or public diagnostic ingress is inferred.');
        }
        if (diagnosticOptions.reader === 'restricted-remote-read')
            addExternalRequirement(ctx, 'diagnostic-reader', [], 'Dedicated loopback reader process/private JSON profile and separately configured TLS IP endpoint; grants and reader credentials must be isolated from API/operator credentials.');
    }
}
export function contributeProviderExternalsAndJobs(ctx) {
    const { config } = ctx;
    if (selection(config, 'auth') === 'auth.firebase') {
        addExternalRequirement(ctx, 'firebase', ['FIREBASE_PROJECT_ID'], 'Preconfigure Firebase client methods and application default credentials; no service account is copied into the image.');
        ctx.jobs.push({
            id: 'identity-cleanup',
            command: ['node', 'dist/drain-identity-cleanup.js', '--limit', '10'],
            scheduler: 'operator',
            concurrency: 'bounded-cas-lease',
            restart: 'no',
            dependsOn: ['database'],
        });
    }
    if (selection(config, 'mail') === 'mail.smtp')
        addExternalRequirement(ctx, 'smtp', ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'], 'Operator SMTP host/TLS and optional paired credentials, reviewed sender/domain/inbox.');
    if (selection(config, 'mail') === 'mail.http')
        addExternalRequirement(ctx, 'http-mail', ['RESEND_API_KEY'], 'Resend account/domain and private runtime API key.');
    if (selection(config, 'push-fcm'))
        addExternalRequirement(ctx, 'fcm', ['FCM_PROJECT_ID', 'FCM_CREDENTIALS_PATH'], 'FCM project and runtime ADC/private credential mount; independently validate device delivery.');
    if (selection(config, 'push-apns'))
        addExternalRequirement(ctx, 'apns', ['APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_KEY_PATH', 'APNS_TOPIC'], 'APNs signing key as an operator-managed read-only secret mount; selected environment/topic/device acceptance.');
    if (config.capabilities.mail?.options.reliableActions === true)
        ctx.jobs.push({
            id: 'mail-drain',
            command: ['node', 'dist/drain-mail.js', '--limit', '20'],
            scheduler: 'operator',
            concurrency: 'bounded-cas-lease',
            restart: 'no',
            dependsOn: ['database'],
        });
}
export function contributeRealtimeAndIngress(ctx) {
    const rt = selection(ctx.config, 'realtime');
    if (rt &&
        ![
            'realtime.native-ws',
            'realtime.socket-io',
            'realtime.centrifugo',
        ].includes(rt))
        throw new Error('UNSUPPORTED_SERVICE_REALTIME');
    ctx.ingress.push({
        service: 'api',
        port: 3100,
        path: '/',
        websocket: !!rt && rt !== 'realtime.centrifugo',
        stickiness: 'none-single-instance',
        tls: 'operator',
        deniedApiPaths: [
            '/api/internal',
            '/api/realtime/centrifugo',
            '/var',
            '/diagnostics',
        ],
    });
    if (rt !== 'realtime.centrifugo')
        return;
    addExternalRequirement(ctx, 'centrifugo', ['CENTRIFUGO_API_URL', 'CENTRIFUGO_API_KEY', 'CENTRIFUGO_PROXY_SECRET'], 'Preconfigure selected ops/centrifugo config; public connection port only, internal API/callbacks private and authenticated. No callback to host.docker.internal is inferred in deployment.');
    ctx.services.push({
        id: 'centrifugo',
        kind: 'realtime',
        execution: 'external',
        image: 'centrifugo/centrifugo:v6.10.3',
        resourceRef: ctx.options.externalResources?.centrifugo ?? ctx.ref('centrifugo'),
        command: [],
        ports: [
            {
                port: 8000,
                visibility: 'public-ingress',
                purpose: 'Centrifugo client WebSocket',
            },
            {
                port: 9000,
                visibility: 'private',
                purpose: 'authenticated internal HTTP API',
            },
        ],
        dependsOn: ctx.topology === 'cluster' ? ['api', 'redis'] : ['api'],
        environment: [
            ...ctx.env.filter((field) => field.key.startsWith('CENTRIFUGO_')),
            { key: 'CENTRIFUGO_CALLBACK_HEADERS', required: true, secret: true },
            ...(ctx.topology === 'cluster'
                ? [
                    {
                        key: 'CENTRIFUGO_ENGINE_REDIS_ADDRESS',
                        required: true,
                        secret: true,
                    },
                ]
                : []),
        ],
        resources: { memoryMiB: 192, cpus: 0.5, pids: 128 },
        health: {
            scope: 'external',
            check: 'Selected Centrifugo health is not application authorization/fanout acceptance',
            applicationAcceptance: false,
        },
        volumes: [],
    });
    if (ctx.topology === 'cluster') {
        addExternalRequirement(ctx, 'redis', ['CENTRIFUGO_ENGINE_REDIS_ADDRESS'], 'Private external Redis >=6.2 for selected Centrifugo shared engine, dedicated role/capacity; no queue/cache SDK or auto provisioning.');
        ctx.services.push({
            id: 'redis',
            kind: 'redis',
            execution: 'external',
            resourceRef: ctx.options.externalResources?.redis ?? ctx.ref('redis'),
            command: [],
            ports: [
                {
                    port: 6379,
                    visibility: 'private',
                    purpose: 'Centrifugo engine only',
                },
            ],
            dependsOn: [],
            environment: [
                {
                    key: 'CENTRIFUGO_ENGINE_REDIS_ADDRESS',
                    required: true,
                    secret: true,
                },
            ],
            resources: { memoryMiB: 256, cpus: 0.5, pids: 128 },
            health: {
                scope: 'external',
                check: 'Private authenticated Redis >=6.2; selected engine/fanout acceptance separately',
                applicationAcceptance: false,
            },
            volumes: [],
        });
    }
    ctx.ingress.push({
        service: 'centrifugo',
        port: 8000,
        path: '/connection/websocket',
        websocket: true,
        stickiness: 'none-single-instance',
        tls: 'operator',
        deniedApiPaths: ['/api', '/admin', '/debug'],
    });
}
//# sourceMappingURL=service-plan-contributions.js.map
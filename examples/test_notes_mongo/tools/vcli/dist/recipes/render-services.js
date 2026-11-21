import { file, json } from './bundle.js';
import { describeServices } from './service-plan.js';
/** Only selected local dependencies. The API remains an ordinary project-local Nest process. */
export function localCompose(plan) {
    if (plan.target !== 'local' ||
        !['development', 'test'].includes(plan.environment))
        throw new Error('LOCAL_SERVICES_REQUIRE_DEVELOPMENT_OR_TEST');
    const database = plan.services.find((service) => service.id === 'database' && service.execution === 'compose');
    const common = {
        restart: 'unless-stopped',
        mem_limit: '512m',
        cpus: 1,
        pids_limit: 128,
        cgroup_parent: plan.cgroupParent ?? '${VCLI_CGROUP_PARENT:-}',
        labels: {
            'io.vcli.project': plan.project,
            'io.vcli.environment': plan.environment,
        },
    };
    const mongo = database?.image?.startsWith('mongo:');
    const services = {};
    if (database) {
        services.database = {
            ...common,
            image: database.image,
            command: database.command,
            ports: [
                {
                    target: mongo ? 27017 : 5432,
                    published: mongo
                        ? '${VCLI_DATABASE_PORT:-27017}'
                        : '${VCLI_DATABASE_PORT:-5432}',
                    host_ip: '127.0.0.1',
                    protocol: 'tcp',
                },
            ],
            volumes: [
                'database-data:' + (mongo ? '/data/db' : '/var/lib/postgresql/data'),
            ],
            ...(mongo
                ? {}
                : {
                    environment: {
                        POSTGRES_USER: 'app',
                        POSTGRES_DB: 'app',
                        POSTGRES_PASSWORD: '${VCLI_POSTGRES_PASSWORD:?Set VCLI_POSTGRES_PASSWORD privately; retain it across restarts}',
                    },
                }),
            healthcheck: {
                test: mongo
                    ? [
                        'CMD',
                        'mongosh',
                        '--quiet',
                        '--eval',
                        'quit(db.adminCommand({ping:1}).ok ? 0 : 1)',
                    ]
                    : ['CMD', 'pg_isready', '-U', 'app', '-d', 'app'],
                interval: '5s',
                timeout: '5s',
                retries: 12,
                start_period: '10s',
            },
        };
        if (mongo)
            services['database-init'] = {
                ...common,
                image: database.image,
                restart: 'no',
                profiles: ['setup'],
                depends_on: { database: { condition: 'service_healthy' } },
                command: [
                    'mongosh',
                    '--host',
                    'database:27017',
                    '--quiet',
                    '--eval',
                    "try { const s=rs.status(); if(s.set!=='rs0') quit(2); } catch(e) { if(e.code!==94) throw e; rs.initiate({_id:'rs0',members:[{_id:0,host:'database:27017'}]}); }",
                ],
            };
    }
    return {
        services,
        ...(database
            ? {
                volumes: {
                    'database-data': {
                        name: plan.volumes.find((volume) => volume.id === 'database-data').resourceRef,
                        labels: {
                            'io.vcli.project': plan.project,
                            'io.vcli.environment': plan.environment,
                            'io.vcli.workspace': '${VCLI_WORKSPACE_ID:?Use the pinned project service command}',
                        },
                    },
                },
            }
            : {}),
    };
}
export function serviceFiles(config, fields, options = {}) {
    // Local service artifacts stay local even when a production target is also selected.
    const capabilities = { ...config.capabilities };
    delete capabilities.deployment;
    if (options.environment !== undefined &&
        !['development', 'test'].includes(options.environment))
        throw new Error('LOCAL_SERVICES_REQUIRE_DEVELOPMENT_OR_TEST');
    const localConfig = { ...config, capabilities };
    const plan = describeServices(localConfig, fields, {
        ...options,
        environment: 'development',
    });
    const testPlan = describeServices(localConfig, fields, {
        ...options,
        environment: 'test',
    });
    return [
        file('ops/local/compose.yaml', json(localCompose(plan))),
        file('ops/local/service-plan.json', json(plan)),
        ...[plan, testPlan].flatMap((profile) => [
            file(`ops/local/${profile.environment}/compose.yaml`, json(localCompose(profile))),
            file(`ops/local/${profile.environment}/service-plan.json`, json(profile)),
        ]),
        file('ops/local/README.md', `# Selected local services

The project API runs through the installed local Nest CLI, without a VCLI watcher/supervisor. Use the pinned project CLI dev/service commands after installation. An explicit environment development/test, private APP_ENV_FILE and selected port are required; process environment overrides the file. No host scan, auto install or provider setup occurs.

The matching ops/local/development or ops/local/test immutable profile manages only the selected native database. ops/local/compose.yaml and service-plan.json remain development aliases. Services bind 127.0.0.1, have explicit CPU/memory/PID caps and distinct environment volume names. VCLI_CGROUP_PARENT or the command cgroupParent option can select a host-specific parent; portable files assume none. Compose service wrappers validate project ownership before mutation; ordinary down never passes --volumes, removes images or rotates credentials.

${plan.services.some((service) => service.image?.startsWith('mongo:')) ? 'MongoDB is a development-only unauthenticated loopback replica set. service up explicitly runs the bounded setup-profile database-init after process health, then checks writable-primary readiness. For the host API use mongodb://127.0.0.1:<selected-port>/app?replicaSet=rs0&directConnection=true. The fixed internal member database:27017 supports the container; directConnection is required from the host. No transactional production MongoDB provisioning is implied.' : plan.services.some((service) => service.id === 'database' && service.execution === 'compose') ? 'Set VCLI_POSTGRES_PASSWORD privately before the first up; preserve it and the named volume. Later changing this setting does not rotate the stored database password. Supply matching DATABASE_URL privately for the host API.' : 'This selection has no local containers to start; a selected cluster uses its external shared native database.'}

APP_ENV_FILE is for the API; Compose interpolation uses explicitly supplied process environment (VCLI_POSTGRES_PASSWORD/VCLI_DATABASE_PORT), never implicitly loads API/private .env files. Environment/service-plan JSON contains only names/metadata. Run schema/release initialization explicitly after service readiness and before application startup; ordinary dev does not initialize schemas.

External providers/Centrifugo and optional native diagnostic tools are declared in service-plan.json and are configured separately through their selected owner assets. No Redis/queue daemon or host-gateway viewer topology is invented. API health does not prove those external dependencies. Stop task-owned dev with SIGINT/SIGTERM; wrappers forward only to their owned process group and release their lock, never kill another process by name or port.
`),
    ];
}
//# sourceMappingURL=render-services.js.map
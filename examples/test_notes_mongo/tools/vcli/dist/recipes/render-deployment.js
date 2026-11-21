import { file, json } from './bundle.js';
import { describeServices, serviceImages } from './service-plan.js';
/** Runtime references only; optional blanks stay empty/normalized by selected config. */
export function serviceEnvironment(plan) {
    const values = {
        NODE_ENV: plan.nodeEnvironment,
        HOST: '0.0.0.0',
        PORT: '3100',
    };
    for (const field of plan.services.find((service) => service.id === 'api')
        .environment) {
        if (Object.hasOwn(values, field.key))
            continue;
        values[field.key] =
            field.required || plan.operatorReview.includes(field.key)
                ? '${' + field.key + ':?Set ' + field.key + ' in runtime settings}'
                : field.defaultValue !== undefined
                    ? '${' + field.key + ':-' + field.defaultValue + '}'
                    : null;
    }
    if (plan.volumes.some((volume) => volume.id === 'app-storage'))
        values.LOCAL_STORAGE_ROOT = '/app/var/storage';
    if (plan.volumes.some((volume) => volume.id === 'app-evidence'))
        values.EVIDENCE_DIRECTORY = '/app/var/evidence';
    return values;
}
function dockerfile(plan) {
    return `# Project-root context; commit the install-links package lock first.
FROM ${serviceImages.node} AS build
WORKDIR /app
ARG VCLI_SOURCE_COMMIT
COPY . .
RUN npm ci --install-links --no-audit --no-fund
RUN npm run build && if [ -n "$VCLI_SOURCE_COMMIT" ]; then node scripts/write-build-metadata.mjs --source-commit "$VCLI_SOURCE_COMMIT"; fi
RUN npm prune --omit=dev --install-links --no-audit --no-fund && test ! -e node_modules/@vcli/cli${plan.services[0].environment.some((field) => field.key === 'SESSION_TTL_SECONDS') ? ' && test -d node_modules/@vcli/auth-runtime && test ! -L node_modules/@vcli/auth-runtime' : ''}
RUN mkdir -p /runtime-assets/migrations /runtime-assets/scripts && if [ -d migrations ]; then cp -R migrations/. /runtime-assets/migrations/; fi${plan.volumes.some((volume) => volume.id === 'app-evidence') ? ' && for asset in scripts/diagnostics-*.mjs; do if [ -f "$asset" ]; then cp "$asset" /runtime-assets/scripts/; fi; done' : ''}
FROM ${serviceImages.node} AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /runtime-assets/migrations ./migrations
COPY --from=build --chown=node:node /runtime-assets/scripts ./scripts
RUN install -d -m 0700 -o node -g node /app/var${plan.volumes.map((volume) => ' ' + volume.containerPath).join('')}
USER node
EXPOSE 3100
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3100/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","dist/main.js"]
`;
}
/** JSON is valid YAML 1.2 and is checked by Docker Compose's native parser. */
export function targetCompose(plan) {
    const api = {
        build: {
            context: plan.target === 'coolify' ? '.' : '../../..',
            dockerfile: 'ops/Dockerfile',
        },
        init: true,
        restart: 'unless-stopped',
        stop_grace_period: '30s',
        mem_limit: '512m',
        cpus: 1,
        pids_limit: 256,
        deploy: { replicas: plan.replicas },
        ...(plan.cgroupParent ? { cgroup_parent: plan.cgroupParent } : {}),
        environment: serviceEnvironment(plan),
        expose: ['3100'],
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        volumes: plan.volumes.map((volume) => `${volume.id}:${volume.containerPath}`),
        labels: {
            'io.vcli.project': plan.project,
            'io.vcli.environment': plan.environment,
        },
        healthcheck: {
            test: [
                'CMD',
                'node',
                '-e',
                "fetch('http://127.0.0.1:3100/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ],
            interval: '30s',
            timeout: '5s',
            start_period: '20s',
            retries: 3,
        },
    };
    const jobs = Object.fromEntries(plan.jobs.map((job) => [
        job.id,
        {
            ...api,
            restart: 'no',
            profiles: ['operations'],
            command: job.command,
            expose: [],
            healthcheck: { disable: true },
            deploy: { replicas: 1 },
        },
    ]));
    return {
        services: { api, ...jobs },
        ...(plan.volumes.length
            ? {
                volumes: Object.fromEntries(plan.volumes.map((volume) => [
                    volume.id,
                    { name: volume.resourceRef, external: true },
                ])),
            }
            : {}),
    };
}
export function deploymentFiles(config, fields, options = {}) {
    const plan = describeServices(config, fields, options);
    if (plan.target === 'local')
        throw new Error('DEPLOYMENT_SELECTION_REQUIRED');
    const base = `ops/deploy/${plan.target}`;
    const files = [
        file('ops/Dockerfile', dockerfile(plan)),
        file('.dockerignore', `# Only build inputs; never private environment/keys/evidence.
**
!package.json
!package-lock.json
!tsconfig.json
!nest-cli.json
!vcli.json
!vcli.lock.json
!src/
!src/**
!scripts/
!scripts/**
!migrations/
!migrations/**
!tools/
!tools/**
**/node_modules
**/.git
**/.vcli
**/var
**/.env*
**/*.pem
**/*.key
**/*credentials*.json
**/*service-account*.json
`),
        file(`${base}/service-plan.json`, json(plan)),
        file(`${base}/environment.json`, json({
            schemaVersion: 1,
            environment: plan.environment,
            nodeEnvironment: plan.nodeEnvironment,
            fields: plan.services[0].environment,
            operatorReview: plan.operatorReview,
            privateFile: 'APP_ENV_FILE is an explicit owner-only runtime path; injected environment wins. Never mount a development/test file for production.',
        })),
    ];
    if (plan.target === 'caprover') {
        files.push(file('captain-definition', json({ schemaVersion: 2, dockerfilePath: './ops/Dockerfile' })), file(`${base}/app-settings.json`, json({
            contract: 'caprover-native-preprovisioned-v1',
            targetVersion: plan.targetVersion,
            settings: {
                containerHttpPort: 3100,
                notExposeAsWebApp: false,
                websocketSupport: plan.ingress.some((item) => item.service === 'api' && item.websocket),
                instanceCount: plan.replicas,
                hasPersistentData: plan.volumes.length > 0,
                ports: [],
                volumes: plan.volumes.map((volume) => ({
                    containerPath: volume.containerPath,
                    volumeName: volume.resourceRef,
                    mode: 'rw',
                })),
            },
            serviceUpdateOverride: {
                TaskTemplate: {
                    Resources: {
                        Limits: { MemoryBytes: 536870912, NanoCPUs: 1000000000 },
                    },
                },
            },
            environmentKeys: plan.services[0].environment,
            preprovisioned: plan.externalRequirements,
            reviewRequired: [
                'Configure HTTPS after DNS/certificate validation.',
                'Persistent apps require deliberate nodeId placement; mount uid/gid 1000, mode 0700.',
                'Apply limits through the native service override editor; validate installed platform schema.',
            ],
            apply: false,
        })));
    }
    else {
        files.push(file(`${base}/compose.yaml`, json(targetCompose(plan))), file(`${base}/platform-settings.json`, json(plan.target === 'dokploy'
            ? {
                contract: 'dokploy-standard-compose-v1',
                targetVersion: plan.targetVersion,
                composeType: 'docker-compose',
                composePath: `./${base}/compose.yaml`,
                domain: {
                    serviceName: 'api',
                    port: 3100,
                    https: 'operator',
                    path: '/',
                },
                isolation: 'Review Preview Compose network/labels; no Stack/build parity.',
                environmentSource: 'Dokploy Environment references; no env_file wholesale injection',
                apply: false,
            }
            : {
                contract: 'coolify-git-compose-v1',
                targetVersion: plan.targetVersion,
                buildPack: 'dockercompose',
                baseDirectory: '/',
                dockerComposeLocation: `/${base}/compose.yaml`,
                domains: [
                    { service: 'api', value: 'https://REVIEWED_API_HOST:3100' },
                ],
                buildArguments: 'Managed manually in Dockerfile; runtime secrets never build variables',
                health: 'Compose/image check, not Application Healthcheck page',
                apply: false,
            })));
    }
    files.push(file(`${base}/README.md`, runbook(plan)));
    return files;
}
function runbook(plan) {
    return `# ${plan.target} ${plan.targetVersion} artifact contract

Environment ${plan.environment}; NODE_ENV=${plan.nodeEnvironment}; API replicas ${plan.replicas}, ${plan.topology} topology. Files are artifacts, not a deployment or automated provisioning result. Unknown versions/topologies fail planning. Reuse existing durable IDs and credentials.
${plan.topology === 'cluster' ? 'This is a generation-only replicated profile. Shared native DB and selected realtime adapter/engine are mandatory. Dokploy/Coolify standard Compose replicas share one Docker host; these artifacts do not provision a cross-host scheduler. CapRover uses native Swarm placement. Storage/evidence roots and native-ws are refused. Native multi-node acceptance is pending.' : ''}

${plan.target === 'caprover' ? 'Upload from project root with captain-definition schema 2. app-settings.json is a native-settings review checklist, not a Compose import or directly replayable API request. Preprovision dependencies using actual discovered native service names. Set container HTTP port 3100, the planned instanceCount, persistence node/placement and resource override explicitly.' : plan.target === 'dokploy' ? 'Choose standard Docker Compose, not Docker Stack. Set composePath from platform-settings.json. Build context resolves relative to compose.yaml. Configure native Domains for api port 3100/TLS; inspect Preview Compose labels/networks and private connectivity.' : 'Choose Git Docker Compose build pack, Base Directory /, Compose Location /ops/deploy/coolify/compose.yaml. Build context resolves from Base Directory. Configure api domain with :3100 internal-port suffix. Use Compose/image healthcheck. Runtime variables must not be marked as build variables; use manually managed build arguments.'}

Commit a reviewed npm install --install-links lock. Build ops/Dockerfile with project-root context. The selected auth-runtime file dependency is copied into node_modules; private CLI development tools are pruned. Only compiled runtime, migrations and selected script assets reach the non-root final stage. Mount SDK credential files read-only privately; configure ADC at runtime. No private .env, source config, keys or runtime-secret build arguments belong in the image.
CI may supply only the reviewed immutable source identity with --build-arg VCLI_SOURCE_COMMIT=<40-hex-commit>. The build invokes the managed metadata writer explicitly after compilation, retaining its output in dist; this is not a runtime environment override. A missing build identity stays null and native operator verification refuses it. Operators verify the actual deployed image digest independently from this source commit.

Use environment.json; optional credentials use bare/null Compose environment entries: an absent operator variable is omitted, and a deliberately supplied blank is normalized by selected application config where supported. Add optional variables explicitly in the target environment settings when needed. Review PUBLIC_ORIGIN, ALLOWED_ORIGINS and MAIL_FROM. Staging uses production Node with separate resource IDs/secrets. APP_ENV_FILE selects an explicit private runtime file; injected environment wins. Never use a development/test file with production Node.

${plan.volumes.map((volume) => `Precreate/reuse ${volume.resourceRef} mounted at ${volume.containerPath}, uid/gid 1000, mode 0700: ${volume.purpose}.`).join('\n')}
Empty named-volume copy-up preserves image ownership; existing root-owned/bind mounts need explicit operator permission repair. Never broad chmod/chown shared roots or remove durable volumes on ordinary down/redeploy.

External requirements:
${plan.externalRequirements.map((item) => `- ${item.id}: ${item.requirement}`).join('\n') || '- None.'}

Explicit jobs:
${plan.jobs.map((job) => `- ${job.id}: ${job.command.join(' ')}; operator schedule, ${job.concurrency}, restart=no.`).join('\n') || '- None.'}
Run identified release migration before API replacement; reconcile incomplete/uncertain history before retry. Boot never migrates. Invoke Compose operations jobs explicitly with compose run --rm using the same image/settings; never enable the operations profile during ordinary deployment. Drains are bounded, not invented queue daemons. Firebase cleanup remains an explicitly integrated owner dispatcher until a command is selected.

TLS ingress to api:3100 only; allow WebSocket upgrades/long-lived connections when selected. Single instance needs no cross-replica affinity and proves no scale-out support. Deny /api/internal, /api/realtime/centrifugo and diagnostic/evidence/filesystem routes at public ingress; preserve actual public ticket routes. Selected Centrifugo has separate /connection/websocket ingress on 8000, private authenticated API on 9000 and private authenticated callbacks. Never publish DB/Redis/internal callbacks/Logdy feed/diagnostic readers/private roots.

GET /health/ready and /health/live establish narrow health scopes, not schema/provider/WebSocket authorization acceptance. Verify those separately, forward SIGTERM and allow 30 seconds. Validate known data/volume IDs before and after restart, release identity and private access denial. Image rollback never reverses migrations. Backup/isolated restore is the explicit release-owner procedure; artifacts alone prove neither.

backup:create and backup:restore run on a dedicated operator host with the matching native pg_dump/pg_restore or mongodump/mongorestore tools and owner-only VCLI_BACKUP_PROFILE/VCLI_RESTORE_PROFILE files. Those tools and private profiles are absent from this Node API image. Keep all dist/release modules and selected migration assets available to that operator workflow. Never mount operator credentials into diagnostic readers or ordinary public API jobs.

Authenticated operators, image/dependency/service checks, live ${plan.target} deployment, providers, backup restore and cluster acceptance remain pending independent gates.
`;
}
//# sourceMappingURL=render-deployment.js.map
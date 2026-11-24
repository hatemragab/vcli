# Native deployment operators

O2 implements deliberately invoked operators for Dokploy **0.31.3**, Coolify **4.7.5**, and CapRover **1.16.0**. The evidence below is isolated compilation and controlled local native-protocol peers. No target account, live platform, provider credential, image registry, TLS route, production resource or deployed application was contacted. This source slice does not pass live P08-A03/A05/A07/A08/A09, establish real platform permissions, or replace root's packed CLI/generated-app gate.

The operators consume O0's selected `ServicePlan`, native artifacts and stable volume/resource references. They bind O1's selected schema manifest **ID**, independently from the immutable image/source identity. References remain read-only historical inputs.

## Manual Dokploy Compose setup

The current local CLI generates Dokploy artifacts when you select `--deploy dokploy`. This example selects MongoDB, basic email/password auth, local storage, and diagnostics.

```sh
vcli init my-new-api-2 --yes --database mongodb --auth local \
  --storage local --diagnostics --deploy dokploy
```

Open `ops/deploy/dokploy/` in the generated app. Use `platform-settings.json` for the Compose and Domains settings, `environment.json` for the selected runtime settings, and `service-plan.json` for private dependencies, named volumes, and release jobs.

| Dokploy field | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| Placement     | The intended Dokploy project, environment, and server                            |
| Resource type | Standard Docker Compose (`docker-compose`)                                       |
| Git source    | The reviewed generated-app repository and branch                                 |
| Compose path  | `./ops/deploy/dokploy/compose.yaml` from the app root                            |
| Domains       | Your API hostname, service `api`, container port `3100`, path `/`, HTTPS enabled |

Include the generated install-links lockfile and vendored packages in the Git source. For an app nested in a Git repository, prefix the Compose path with the app's repository-relative directory. The Compose build context resolves to the app root and uses `ops/Dockerfile`.

In Dokploy Environment, set `DATABASE_URL`, `REDIS_URL`, `JWT_KEYS_JSON`, and `JWT_ACTIVE_KID` through private runtime settings. Set `PUBLIC_ORIGIN` to the public HTTPS API origin and `ALLOWED_ORIGINS` to the comma-separated allowed frontend origins. The Compose file sets `NODE_ENV=production`, `HOST=0.0.0.0`, and `PORT=3100`.

Use a privately reachable MongoDB replica set with a writable primary, or a sharded deployment that supports transactions. Use a privately reachable Redis service for expiring auth quotas. The app's local development Redis URL uses loopback, so set the hostname reachable from the deployed API container in Dokploy. Use independently generated production signing keys.

Precreate or reuse the external volume names from `service-plan.json`. This selection mounts `app-storage` at `/app/var/storage` and `app-evidence` at `/app/var/evidence` on a single instance. The API runs as UID/GID `1000` and needs both roots owned by that user with mode `0700`. Local private storage requires Linux with `/proc/self/fd` available in the runtime.

Review Preview Compose for network connectivity and labels. Run the explicit `release` job (`node dist/initialize-database.js`) with the same reviewed build and database settings before starting or replacing the API. Keep the `operations` profile disabled during ordinary deployment. Check `/health/ready` after the API starts.

## Public integration contract

Import from `src/deployment/operators/index.ts` (compiled `dist/deployment/operators/index.js`). No new dependencies, recipe/catalog/config changes, templates, migrations, environment fields or application assets are contributed by O2. There is no CLI registration helper in this slice; root owns command registration, package/distribution and every actual target action.

| Export                                                                                           | Contract                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadTargetProfile(path)`                                                                        | Read explicit absolute private JSON file with nofollow, owning UID, regular-file/single-link checks, exactly0600 and a1MiB limit. No environment credential lookup.                |
| `parseServicePlan(unknown)`                                                                      | Strict bounded O0 model, including64-character project metadata and the selected bounded identity-cleanup job.                                                                     |
| `parseReleaseFacts(unknown)`                                                                     | Strict bounded release input; credential-free HTTPS URLs, immutable source commit, optional OCI digest reference, explicit nonsecret setup references.                             |
| `parseDeploymentSnapshot(unknown)`                                                               | Strict native technical projection and matching fingerprint; rejects unknown fields and private environment values.                                                                |
| `parseDeploymentPlan(unknown)`                                                                   | Strict shape plus semantic re-planning and identical plan ID/step sequence.                                                                                                        |
| `parseReconciliationDecision(unknown)`                                                           | Exact observed fingerprint, plan, first unfinished step and quiesced evidence; optional expected orphan-lock ID.                                                                   |
| `loadDeploymentPlan`, `loadReleaseFacts`, `loadDeploymentSnapshot`, `loadReconciliationDecision` | Apply the matching parser to the same bounded private-file reader.                                                                                                                 |
| `saveDeploymentPlan(path,plan)`, `saveDeploymentSnapshot(path,snapshot)`                         | Explicit save,0600 exclusive/no-overwrite/nofollow creation and fsync. Existing files, symlinks and hardlinks are preserved. Parent must already exist.                            |
| `discoverDeployment(profile, options?)`                                                          | Authenticated, read-only native discovery; returns only bounded nonsecret technical state. No local journal writes.                                                                |
| `planDeployment(servicePlan,snapshot,releaseFacts)`                                              | Pure planning; no files, process environment, network, journal or mutation. A dry-run uses an explicitly supplied saved snapshot.                                                  |
| `assertDeploymentProfile(plan,profile):void`                                                     | Pure scope, version, environment-key, fixed-runtime-value and exclusive/secret-source binding checks, also suitable for CLI previews.                                              |
| `applyDeployment(plan,profile,options?)`                                                         | Recheck before every mutation, write private intent/progress, perform finite native steps, return a nonsecret summary. Success is `applied-unverified`.                            |
| `inspectDeployment(plan,profile,options?)`                                                       | Read private progress/lock plus deliberately invoked fresh native discovery; no mutation or local directory creation.                                                              |
| `reconcileDeployment(plan,profile,decision,options?)`                                            | Resolve an identified incomplete/unknown step, or explicitly rebase a pending stale step for retry. No destructive compensation.                                                   |
| `verifyDeployment(plan,profile,options?)`                                                        | Recheck native resource/settings and native release identity, then use a separate unauthenticated public HTTPS readiness request.                                                  |
| `createDeploymentOperator(profile,options?)`                                                     | Safe facade exposing `discover()`, `readSnapshot()`, `apply(plan)`, `inspect(plan)`, `reconcile(plan,decision)`, `verify(plan)`. It exposes no unchecked native mutation function. |

`OperatorOptions` is `{fetch?: typeof fetch, timeoutMs?: number}`. The injected transport is a controlled-test seam; production uses built-in fetch. Timeout is10…30000ms, default15000ms for native requests and5000ms for public readiness. Native bodies are limited to1MiB, readiness to32KiB, lists are bounded, container inspections are capped at32, and requests are serial. Redirects, credential-bearing URLs and response origin drift fail. Raw provider/network/body errors are discarded. `DeploymentOperatorError` exposes only a fixed `code` and optional public `summary`; root should print these, never a profile, request, transport exception or raw journal.

### Private target profile

The exact type is `TargetProfile` in `types.ts`:

```ts
{
  schemaVersion: 1,
  target: 'dokploy' | 'coolify' | 'caprover',
  origin: 'https://the-explicit-platform-origin',
  targetVersion: 'the-exact-supported-version',
  scope: {
    namespace, projectId, environmentId, serverId, appName,
    resourceId?, destinationId?, nodeId?
  },
  token,
  journalDirectory, // explicit absolute operator-owned0700 directory
  environment: { /* only deliberate managed runtime keys and private values */ },
  replaceEnvironmentKeys: [ /* exact existing keys deliberately replaced */ ],
  exclusive: {
    quiesced: true,
    evidenceRef: 'ticket:exclusive-native-writer',
    secretRevisionRef: 'secret-source:reviewed-version'
  }
}
```

Keep this file outside source/build context and `vcli.json`. It is an execution input, not a recipe option or saved plan. All ancestors must be real directories; file and journal symlinks are rejected. Journal files are0600, the directory is0700, and writes use exclusive temporary files, atomic rename and fsync. Owner/root processes remain within the same OS trust boundary; this does not provide isolation from another process with the same UID or from the platform administrator.

Dokploy scope binds organization ID, project ID, environment ID, remote server ID, the selected Compose display name, and optional expected Compose ID. Discovery checks the session organization, permission matrix, project/environment/server relations, Compose relations and native Domains. Dokploy may suffix its internal Compose appName; the operator records and uses the discovered internal name instead of guessing it.

Coolify binds the token's numeric team ID as a string, project/environment UUIDs, server UUID, destination UUID and selected app name/optional UUID. UUID containment is verified through scoped project/environment responses and the app's primary-destination response; no invented numeric relationship IDs are needed. Only one standalone Docker destination is supported for this Git Compose profile. Tokens need native read/write/deploy permissions, appropriate resource access, and `read:sensitive` configuration visibility. Hidden execution hooks cause refusal. Each native endpoint still enforces real authority; read discovery cannot prove every later write/deploy ability.

CapRover uses its native root namespace `captain`, a pre-existing native project ID, `environmentId:'preprovisioned'`, `serverId:'captain'` (the single platform scope, not a fictitious server UUID), appName/optional identical resourceId, and optional explicit native Swarm nodeId. Native root-domain SSL must already be enabled before any app mutation; a selected persistent node must be discovered ready/active. App-deploy tokens and diagnostic identities cannot perform the secured discovery/settings lifecycle; supply a separately authorized administrator identity. CapRover does not provide per-app administrator-token isolation: root must assess whether this authority fits the target policy before a live action.

### Nonsecret release facts

`ReleaseFacts` contains a UUID `operationId`, exact lowercase40-hex `sourceCommit`, public `readinessUrl` ending in `/health/ready`, optional `schemaReleaseId`, and distinct `managedEnvironmentKeys`. Dokploy and CapRover require `image:'registry/repository@sha256:<64 lowercase hex>'`; Coolify requires `source:{repository:<credential-free HTTPS Git URL>,branch:<explicit safe branch>}` and pins that exact `sourceCommit` through `git_commit_sha`. It accepts no arbitrary shell text or scripts.

The `preconditions` object requires `exclusiveRef`, `secretRevisionRef`, `ingressRef`, `externalResources:{resourceRef:evidenceRef}`, `volumes:{resourceRef:evidenceRef}`, and an optional CapRover `nodeId` matching private scope. Missing or extra resource references fail. A DB plan requires its exact O1 `schemaReleaseId`; a non-DB plan omits it. The public plan binds every selected requirement, namespace/resource/scope ID, settings fingerprint, operation, source/image identity and schema identity. Credentials, private profile paths and runtime environment values are absent from that plan and its hash.

For every auth-enabled profile, supply `REDIS_URL` in the private runtime environment and include its name in `managedEnvironmentKeys`. Bind the Redis instance with `--resource auth-redis=<resource-id>` and include that resource ID in `preconditions.externalResources`. A selected Centrifugo cluster engine uses its own `--resource redis=<resource-id>` binding and `CENTRIFUGO_ENGINE_REDIS_ADDRESS` setting.

`ingressRef` is explicit independent evidence for reviewed private-path denials, private callbacks/provider/database/diagnostic routes, network/body/timeout policy and TLS/WebSocket routing. Native Domains/SSL configuration alone does not enforce the O0 path-denial list. The operator does not pretend that rendered text applies these rules. External-resource evidence covers preprovisioned private connectivity/least privilege; volume evidence covers existing durable names, node placement, owner1000/mode0700 where required, retained data and backup policy. These attestations are necessary manual setup preconditions, not automatically verified provider evidence.

The APIs have no universal secret-safe revision/CAS. Therefore **all managed mutations require deliberate exclusive-writer/quiescence and secret-source evidence**, re-read nonsecret settings immediately before each step, and reject stale state. Fingerprints include only strict technical settings and environment **key names**. They never hash raw environment, nginx configuration, logs, arbitrary Compose or secret values as a substitute for a revision. An uncoordinated remote secret-value change cannot be detected by these APIs; stop and reconcile under the declared exclusive-writer procedure rather than assuming atomic compare-and-set.

Only keys named by the plan may come from `profile.environment`. Every existing managed key needs an explicit entry in `replaceEnvironmentKeys`. Custom keys/settings survive targeted native writes; ambiguous existing dotenv, unknown execution hooks, host/file mounts or resource overrides fail. Dokploy preserves untouched dotenv lines; managed values containing a single quote, backslash, newline or NUL require separately reviewed native manual setup and are refused by this profile. Coolify writes only listed runtime literal keys with build-time disabled; it also disables automatic build-argument injection and enables native env-log redaction. CapRover PATCH merges current env entries in memory, replacing only deliberate keys. Private values never reach a journal.

Explicit runtime private-file mounts (`APP_ENV_FILE`, credential `*_PATH`/`*_FILE` and `GOOGLE_APPLICATION_CREDENTIALS`) require a separate reviewed mount profile and are refused here. No SDK/credentials for an unselected provider are introduced. Workload identity and directly injected supported runtime values remain external setup choices. Private storage/evidence may use the existing single-instance O0 durable-root profile; cluster with any such local root is rejected. Cluster requires a shared native DB,2…8 replicas and O0's compatible selected transport. Dokploy/Coolify standard Compose remains one Docker host; CapRover uses native Swarm. This is generation-only finite scale support, not actual fan-out/session/revocation/scheduler/placement acceptance.

## Native translations

| Platform | Native lifecycle and identity checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dokploy  | `/api/compose.create` with `sourceType:'raw'`, `composeType:'docker-compose'`, environment/server IDs, discoverable operation description and standard Compose generated from O0 with its build replaced by the exact immutable image. `/api/compose.update`, `/api/compose.saveEnvironment`, `/api/domain.create` for HTTPS api:3100 and `/api/compose.deploy` with `freshVolumes:false`. Never Stack or volume reset. Verification checks completed Compose status, exact managed composition, native Domains, scoped container labels, running container `Config.Image` digest reference, source label, replica count and actual mounted volume names/paths through `docker.getContainersByAppNameMatch`/`docker.getConfig`; private Config.Env is discarded. |
| Coolify  | `/api/v1/applications/public` creates a Git Compose app with project/environment/server/destination UUIDs, immutable `git_commit_sha`, `build_pack:'dockercompose'`, `base_directory:'/'`, `/ops/deploy/coolify/compose.yaml`, HTTPS api domain with `:3100`, auto/preview deployment off and `instant_deploy:false`. Native PATCH updates only selected fields; `/envs/bulk` writes deliberate runtime keys; `/start` explicitly queues deployment. Verification checks selected source/settings, native storage bindings and latest finished production deployment's exact commit through `/deployments/applications/{uuid}`. No generic service/Compose API is substituted for Git Compose.                                                                   |
| CapRover | `/api/v2/user/apps/appDefinitions/register/` with native app/project/persistence fields, PATCH `/update/` for containerHttpPort3100, instances, retained named volumes, nodeId, resource limits, runtime env, WebSocket/forceSSL and no public raw ports. Native `/customdomain/` and `/enablecustomdomainssl/` (or base-domain SSL) manage the selected HTTPS hostname. `/api/v2/user/apps/appData/{appName}/` receives `captainDefinitionContent` containing schema2/imageName and `gitHash`; no tar upload or Compose import. Verification checks native deployed-version image/source history, settings, volumes and SSL/domain. Dependencies remain preprovisioned.                                                                                         |

Existing named volume references cannot be removed or rebound silently. The plan preserves the discovered durable bindings. Coolify native storage metadata must expose the selected exact named roots for successful verification; hidden/ambiguous mounts are refused rather than inferred. New named volumes are not explicitly provisioned by O2. The evidence references must establish their pre-existence; a false manual assertion cannot be made safe by an API payload.

Build/push the reviewed image through existing tooling before Dokploy/CapRover application. Coolify builds the reviewed immutable Git source through its native lifecycle. Run the selected O1 schema job (`node dist/initialize-database.js`) through a separately authorized finite release procedure before readiness can succeed. Optional mail/identity drains remain bounded operator jobs; this API slice does not evaluate shell commands or introduce a daemon/supervisor. Native DB tools and encrypted backup profiles belong on the operator host, outside the API image. Image rollback does not undo schema/provider effects, and O2 performs no schema or destructive rollback.

## Progress, interruption and reconciliation

Before mutation, the private journal persists `incomplete`; acknowledged steps become `completed`, uncertain steps stay `unknown`. It records plan/operation identity, created/reused resource ID, nonsecret checkpoints and bounded operator decisions. A scope binding prevents a newly generated plan from bypassing a previous unverified/unknown operation; finish verification or explicitly reconcile the original plan. No target delete/reset, credential replacement or volume recreation is used as compensation.

Creation recovery discovers the original operation marker on Dokploy/Coolify, or CapRover's native unique app name within the exact project following a journaled absent-name precondition and exclusive-writer attestation. One provable resource resumes the same ID. A timeout before creation with no discoverable result remains unknown; zero results does not prove failure. Duplicate or unprovable results refuse continuation. A new create request requires explicit quiesced evidence that the old request settled, a matching observed fingerprint, and a `retry` decision. Domain creation also reuses an exact discovered domain on a reconciled retry.

A process interruption may retain a private target lock. `inspect` returns its nonsecret lock ID; after actually stopping the old runner and settling native in-flight work, reconciliation requires that exact lock ID. There is no clock/lease-based takeover. An interrupted/unknown environment write cannot be confirmed by hashing secrets: inspect privately, provide the exact step/fingerprint and external evidence, then choose `completed` or deliberately retry with explicit replacement keys. Pending stale steps can be explicitly rebased with a `retry` decision. All mutations retain pre/postcondition checks; a successful HTTP acknowledgement that did not apply settings fails.

Readiness is a separate public unauthenticated HTTPS GET with no operator token/cookies/redirects. Required JSON is `{status:'ready',buildId:<sourceCommit>,schemaReleaseId:<selectedManifest.id>}`; omit schemaReleaseId when no DB is selected. Root supplies immutable source metadata, never an environment-derived build ID. An image cannot contain its own final OCI digest without self-reference: native image/deployment identity and immutable source build metadata are checked independently. Probe success alone does not prove image provenance, provider behavior, private routing, every replica or persistent data. Apply never reports verified; verification is a distinct operation and later inspections describe the last observation, not a continuous controller.

## Source manifest and verification

Owned source is `src/deployment/operators/{types,validation,input-schemas,plan,plan-files,private-files,native-http,compose,postconditions,dokploy-operator,coolify-operator,caprover-operator,operator,summary,deployment-operator-error,index}.ts`, with `test/deployment-operator-native.test.ts` and this document. O0/O1 source, root wiring/package/lock, runtime templates and reference applications were not edited by O2.

The fixture compiles only its imported closure into a unique ignored `var/cli-deployment-operators/compiled-*` directory, starts one test-owned ephemeral loopback HTTP peer at a time, rejects all other network origins and closes connections in cleanup. Its HTTPS mapping is an explicit fake transport and supplies **no real TLS/provider/platform evidence**. It exercises all three payload families, stale settings, scope/authority denial, token redaction, deliberate env preservation, timeout before/after create, duplicate discovery, interrupted steps, explicit reconciliation, native source/image mismatch and readiness source/schema mismatch. Public input/save/lock negatives are also required by the final recorded run.

Focused commands:

```sh
node --test --test-concurrency=1 test/deployment-operator-native.test.ts
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --noUncheckedIndexedAccess --module NodeNext --moduleResolution NodeNext --target ES2023 --allowImportingTsExtensions --skipLibCheck --esModuleInterop --types node src/deployment/operators/index.ts test/deployment-operator-native.test.ts
node_modules/.bin/eslint src/deployment/operators test/deployment-operator-native.test.ts
node_modules/.bin/prettier --check src/deployment/operators test/deployment-operator-native.test.ts docs/CLI-DEPLOYMENT-OPERATORS.md
```

Final worker verification on17 November2026: **38 passed,0 failed,0 skipped** in the controlled native-protocol suite, with its isolated compiler closure; scoped strict noEmit, ESLint and Prettier checks each exited0. The earlier single-volume schema failure was corrected before this final evidence; intermediate failing runs are not acceptance. No installs, Docker/services, browser/preview, shared/root/reference builds, provider calls, provisioning, commits, pushes or publication were performed by this worker. Root owns actual packed installation/command integration and all real native target/TLS/route/persistence/restore/scale acceptance. Missing live target credentials/resources remain explicit external setup, not a passing phase gate.

## Primary API contracts reviewed

Reviewed17 November2026 using Context7 and the exact official tagged source. These are reviewed implementation contracts; controlled fixtures cannot certify live compatibility.

- Dokploy0.31.3: [Compose router](https://github.com/Dokploy/dokploy/blob/v0.31.3/apps/dokploy/server/api/routers/compose.ts), [native Compose schemas](https://github.com/Dokploy/dokploy/blob/v0.31.3/packages/server/src/db/schema/compose.ts), [native Domains](https://github.com/Dokploy/dokploy/blob/v0.31.3/apps/dokploy/server/api/routers/domain.ts), [Docker inspection router](https://github.com/Dokploy/dokploy/blob/v0.31.3/apps/dokploy/server/api/routers/docker.ts), [permission resolution](https://github.com/Dokploy/dokploy/blob/v0.31.3/packages/server/src/services/permission.ts), [standard Compose/environment docs](https://docs.dokploy.com/docs/core/docker-compose).
- Coolify4.7.5: [API route/middleware contracts](https://github.com/coollabsio/coolify/blob/v4.7.5/routes/api.php), [application/settings/env/storage lifecycle](https://github.com/coollabsio/coolify/blob/v4.7.5/app/Http/Controllers/Api/ApplicationsController.php), [deploy/history lifecycle](https://github.com/coollabsio/coolify/blob/v4.7.5/app/Http/Controllers/Api/DeployController.php), [destination relationships](https://github.com/coollabsio/coolify/blob/v4.7.5/app/Http/Controllers/Api/DestinationsController.php), [Git Compose docs](https://coolify.io/docs/applications/builds/docker-compose).
- CapRover1.16.0: [native app definition routes](https://github.com/caprover/caprover/blob/v1.16.0/src/routes/user/apps/appdefinition/AppDefinitionRouter.ts), [PATCH merge behavior](https://github.com/caprover/caprover/blob/v1.16.0/src/handlers/users/apps/appdefinition/AppDefinitionHandler.ts), [native deploy route](https://github.com/caprover/caprover/blob/v1.16.0/src/routes/user/apps/appdata/AppDataRouter.ts), [schema2 immutable-image lifecycle](https://github.com/caprover/caprover/blob/v1.16.0/src/user/ImageMaker.ts), [native model](https://github.com/caprover/caprover/blob/v1.16.0/src/models/AppDefinition.ts), [native status codes](https://github.com/caprover/caprover/blob/v1.16.0/src/api/ApiStatusCodes.ts), [native app configuration](https://caprover.com/docs/reference/app-configuration).

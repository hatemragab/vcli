# Realtime, diagnostics and operations worker delivery

Historical delivery report: the file list and commands below identify the original implementation. The current integration entry is `src/modules/realtime/realtime.module.ts`; the flat services and their new names are documented in [realtime](../docs/realtime.md) and [operations](../docs/operations.md). This historical evidence does not verify the later simplification.

This worker implemented only the assigned owned reference-app paths. It did not edit shared/root/other-worker files, install dependencies, build/launch the application or services, run protocol/reader/MCP tests, invoke Docker, provision, deploy, commit, push or mark generator phases complete.

## Integration

- `createOperationsRuntime(config, authority)` at `src/modules/realtime/public/create-operations-runtime.ts` returns the requested Nest module/attach/close plus the shared `publisher: EventPublisher`, `diagnostics` and `reader`. Call attach after Nest init and before listening; pass publisher to notes. All ordinary HTTP controllers omit `/api` so root's prefix applies.
- The previous shared build's MCP JSON-schema type error is resolved by converting Zod schemas with `z.toJSONSchema` and validating actual tool definitions through the official SDK `ToolSchema`; no `any` or schema-object spread remains. The SDK's low-level Server handlers return safe error codes rather than echo rejected filter values or malicious field names.
- Socket.IO/native ws use the current durable-session authority, original credential expiry, per-connection audience references, idle checks, limits and cleanup. Native tickets are atomic local-process single-use credentials, never session IDs. Centrifugo uses private per-connection channels, real connect/refresh envelopes and private HTTP API requests, with independent API/callback secrets and no client-header forwarding.
- `ops/compose.development.yml` matches the root Makefile path; explicit profiles select optional local databases/Centrifugo/Vector. The Orca cgroup policy is confined to the local example override. Deployment targets have individual artifacts/manual runbooks, and no automated operator is claimed.

## Checks executed by this worker

- Scoped Prettier writes over owned source/test/docs/ops/client/script paths: completed. No global formatting.
- `node_modules/.bin/eslint src/modules/realtime src/modules/diagnostics test/realtime*.test.ts test/diagnostics*.test.ts`: final exit 0.
- Targeted TypeScript Compiler API check: tsconfig compiler options, 18 owned realtime/diagnostics source entry points, transitive imports, `noEmit: true`, no build/execution: final exit 0. Initial MCP schema typing and one lint issue were fixed before this result.
- `node --check` for the three client `.mjs` files and `scripts/diagnostics-mcp.mjs`; `sh -n ops/diagnostics/logdy-live.sh`: passed. The MCP launcher was syntax checked again after its final configuration edits.
- Python relative-link and JSON parse checks: five owned guides/runbooks and two JSON artifacts passed.
- Installed `js-yaml` named `load` parser: five owned YAML artifacts passed. This is syntax evidence only, not Compose/provider/Vector VRL acceptance.
- Context7/API verification covered maintained Socket.IO/ws/MCP APIs; official sources additionally covered Centrifugo v6.10.3 proxy/config/API and JS client, Vector, Logdy and the three deployment platforms. Sources are linked in owned guides.

## Ready for coordinator's serial runner

After the coordinator's build, run `node --test --test-concurrency=1 test/realtime*.test.ts test/diagnostics*.test.ts` from the app root. This worker did not execute this command. Tests exercise actual Socket.IO/ws frames using controlled authority, native ticket replay/expiry/revocation and pre-admission denial, publication authority/count/concurrency fences, fake-provider Centrifugo proxy/API envelopes, local reader rotation/redaction/path/scope/cursor negatives, bounded logging failures, and the real MCP SDK over its in-memory transport. They do not certify external services, real databases/identity providers or deployments.

## Material limits and external setup

- Single API instance only; no shared tickets, cluster fanout, replay/history, presence, direct JWT grants or exactly-once delivery. Idle registry recheck is nominally 1 second plus a 2-second authority deadline, subject to event-loop availability; bytes already dispatched cannot be recalled.
- Socket.IO closes its attached HTTP server on shutdown through its maintained SDK. Root owns the shared HTTP shutdown lifecycle.
- Centrifugo actual SDK/service envelopes, expiry grace/outages/header routing and deployed TLS remain pending. A native API must listen on its private host interface for container callbacks, with firewall restrictions; private internal API is local port 59000/api. Server references without refresh expire locally after 15 seconds because there is no disconnect callback.
- Diagnostics is fixed-project/environment, same-user local stdio, not a sandbox. Unknown ingestion delay, exact crash/overflow losses and uncollected DB/worker/infrastructure/Vector sources remain explicit. No tests-result tool, remote backend or isolated-production access profile is advertised. The runtime diagnostics handle exposes writer availability/drop counters for root's HTTP event wiring.
- Vector YAML has not been VRL-validated or run. Logdy uses the real documented socket feed, with UI loopback/FIFO bounds; its private Docker host-gateway feed binding and firewall must be configured explicitly. Collector/viewer execution and sentinel/overload evidence remain pending.
- Dockerfile/image builds, selected services, Dokploy/Coolify/CapRover native ingress/resources/persistence, authenticated operators, backups/restores, external providers and physical devices were not executed. Native release instructions use the complete `node scripts/migrate.ts` entry point after build for identity, media, push and notes. Identity has its own locking/history; the other owners' bounded current-schema setup has separate idempotency limits and no generalized migration history or atomic release guarantee.

## Operations review corrections, 16 November 2026

This correction changed exactly these six files:

- `ops/Dockerfile`: image-owned `/app/var`, storage and evidence directories use the base image's `install -d -m 0700 -o node -g node` during image construction. The non-root runtime has no privileged permission initializer.
- `docs/operations.md`: documents private mounted-root preparation and the complete post-build `node scripts/migrate.ts` release action, which initializes identity, media, push and notes. The identity-only command remains explicitly scoped; current-schema idempotency, separate owner steps, partial failure and outcome reconciliation limits are explicit.
- `ops/deploy/dokploy/README.md`, `ops/deploy/coolify/README.md`, `ops/deploy/caprover/README.md`: each requires operator-prepared mode 0700 / UID/GID 1000 mounted roots and the complete command as a separate identified release job before API replacement. Existing volume contents/identities are preserved; failure or uncertainty requires inspection/reconciliation before retry.
- `ops/worker-delivery-report.md`: replaces the superseded identity-only release description and records this correction.

Checks used only installed tools from `examples/reference-api`:

- Scoped `node_modules/.bin/prettier --write` and `--check` over those five Markdown files: passed.
- `python3` static Dockerfile review: two pinned stages, ten existing build-context source paths, build-stage copy reference, private directory setup, non-root execution and JSON command checked. Extracted `RUN`/healthcheck commands passed four `sh -n` checks; healthcheck JavaScript passed `node --check --input-type=commonjs`. This is text/syntax evidence, without a Docker parser or image build.
- `python3` path/reference check: release entry point, six source import paths, both Docker ignore patterns, all three platform release/permission requirements, and 23 local document links/anchors across seven owned guides/reports passed. An initial checker incorrectly expected the conventional denylist ignore file to be an allowlist; that checker assumption was corrected before the final pass.
- `node --input-type=module` with installed `js-yaml` `load` and `JSON.parse`: all five ops YAML files and two JSON artifacts passed syntax checks. No Compose, provider or Vector execution was performed.

The coordinator owns startup/config regressions and the identity worker owns credential establishment. This correction ran no installs, app/service/browser launches, Docker commands/image builds, builds, global TypeScript emission, migrations, commits, pushes, provisioning or deployments. Image/runtime/private-volume acceptance, real database release/concurrency/failure acceptance, providers, backup/restore and every platform deployment remain pending.

## Exact owned files changed/created

- `examples/reference-api/clients/centrifugo.mjs`
- `examples/reference-api/clients/native-ws.mjs`
- `examples/reference-api/clients/socket-io.mjs`
- `examples/reference-api/docs/operations.md`
- `examples/reference-api/docs/realtime.md`
- `examples/reference-api/ops/.dockerignore`
- `examples/reference-api/ops/Dockerfile`
- `examples/reference-api/ops/Dockerfile.dockerignore`
- `examples/reference-api/ops/centrifugo/config.json`
- `examples/reference-api/ops/compose.development.yml`
- `examples/reference-api/ops/deploy/caprover/README.md`
- `examples/reference-api/ops/deploy/caprover/captain-definition`
- `examples/reference-api/ops/deploy/coolify/README.md`
- `examples/reference-api/ops/deploy/coolify/compose.yml`
- `examples/reference-api/ops/deploy/dokploy/README.md`
- `examples/reference-api/ops/deploy/dokploy/compose.yml`
- `examples/reference-api/ops/diagnostics/logdy-live.sh`
- `examples/reference-api/ops/diagnostics/vector.yaml`
- `examples/reference-api/ops/local/compose.orca.example.yml`
- `examples/reference-api/ops/local/services.env.example`
- `examples/reference-api/ops/worker-delivery-report.md`
- `examples/reference-api/scripts/diagnostics-mcp.mjs`
- `examples/reference-api/src/modules/diagnostics/adapters/diagnostic-schema.ts`
- `examples/reference-api/src/modules/diagnostics/adapters/local-diagnostic-reader.ts`
- `examples/reference-api/src/modules/diagnostics/adapters/rotating-jsonl-events.ts`
- `examples/reference-api/src/modules/diagnostics/public/create-diagnostics-mcp.ts`
- `examples/reference-api/src/modules/diagnostics/public/create-diagnostics-runtime.ts`
- `examples/reference-api/src/modules/diagnostics/public/diagnostic-events.ts`
- `examples/reference-api/src/modules/diagnostics/public/diagnostic-reader.ts`
- `examples/reference-api/src/modules/realtime/adapters/centrifugo-adapter.ts`
- `examples/reference-api/src/modules/realtime/adapters/centrifugo-api.ts`
- `examples/reference-api/src/modules/realtime/adapters/connection-registry.ts`
- `examples/reference-api/src/modules/realtime/adapters/native-ws-adapter.ts`
- `examples/reference-api/src/modules/realtime/adapters/protocol-validation.ts`
- `examples/reference-api/src/modules/realtime/adapters/socket-io-adapter.ts`
- `examples/reference-api/src/modules/realtime/adapters/ticket-vault.ts`
- `examples/reference-api/src/modules/realtime/public/create-operations-runtime.ts`
- `examples/reference-api/src/modules/realtime/realtime.module.ts`
- `examples/reference-api/src/modules/realtime/transport/centrifugo-proxy.controller.ts`
- `examples/reference-api/src/modules/realtime/transport/realtime.controller.ts`
- `examples/reference-api/test/diagnostics-mcp.test.ts`
- `examples/reference-api/test/diagnostics-reader.test.ts`
- `examples/reference-api/test/realtime-centrifugo.test.ts`
- `examples/reference-api/test/realtime-protocol.test.ts`
- `examples/reference-api/test/realtime-tickets.test.ts`

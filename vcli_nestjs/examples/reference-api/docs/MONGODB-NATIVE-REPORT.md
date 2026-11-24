# MongoDB native reference worker report

Implemented inside examples/reference-api only. VCLI remains unimplemented; no installs, downloads, shared builds/dist emission, services, browser sessions, worktrees, commits, publication, provisioning or deployment were performed by this worker. Package-lock.json, node_modules, dist, var and the isolation-worker files were preserved; the coordinator regenerated the selected lock separately. Concurrent logging/HTTP/bootstrap integration and listener regression changes were preserved.

## Implemented capabilities

- The app now contains one MongoDB/Mongoose implementation: no runtime Database union, selector, RepositoryAdapter, dual RepositoryDefinition, application memory driver, SQL implementation or SQL migration remains. The manifest removes drizzle-orm, pg and @types/pg; legacy DATABASE_DRIVER is explicitly rejected. Environment examples, Compose/host override, Docker/release setup, production artifacts and active docs reflect MongoDB only.
- Native BaseRepository holds the protected Mongoose model and selected MongoDatabase. It implements the entire requested catalog: create/createMany; by-ID/one/many/OrThrow reads; exists/count/distinct; pagination; updateOne/updateMany/returned updates; explicit upsert; all deletion variants; bounded async cursors; typed aggregation/bulk writes; native filters/operators/sort/projection/population and shared context/session options. [Exact signatures and failure semantics](base-repository.md) are documented.
- Public string id maps to indexed _id in native filters (including logical branches), sorting and distinct access. Defaults return plain public records; projection-only views default to Partial<T>, populated views default to unknown-valued records unless explicitly declared, and write summaries are distinct plain objects. Read-only option types cannot silently claim a full entity when a projection variable is supplied.
- Empty-filter writes require explicit allowAll. createMany validates/saves sequentially on one active transaction and rolls back on failure. Bulk writes force insert/replacement validation, preserve native partial-error metadata, retain model bulk hooks while avoiding per-document save/update hooks, and document ordered/unordered partial outcomes; ID mutation, pipelines and implicit bulk upserts are refused. Upsert handles both source/destination rename overlaps.
- Session identity is propagated everywhere, including recursive lean/ordered population in transactions; conflicting context/native/populate sessions fail. Native cursor advancement remains correct when _id is projected away, and cursors close on completion, failure or early break.
- Atomic owner security workflows retain credential replacement/version advance/revocation from {token,password} proof, strict refresh, account/installation binding, Argon2/JOSE/Firebase policy, rate limiting, unknown outcomes, immutable private media, push generation fencing, realtime revocation and cleanup. Existing database regressions now use prepared real Mongo fixtures; state/provider fakes are test-owned.
- Every database-dependent suite uses TEST_DATABASE_URL with an explicit setup skip when missing. All four schema owners remain in scripts/migrate.ts with preserving repeated setup. The local demo requires a prepared local replica set and uses private initial email-proof capture; a successful known-credential login makes restarts preserving/idempotent.
- Removed ineffective transaction timeoutMS after verifying installed MongoDB driver 7.8 source. Its native retry-admission window is 120 seconds per withTransaction call; application duplicate-race calls are capped at three and commit actions use maxCommitTimeMS=10000. There is no claimed 15-second/fixed total wall-clock bound and no Promise.race.

## Verification performed

- `./node_modules/.bin/tsc --noEmit`: passed against current application source.
- `node /tmp/vcli-mongo-typecheck.cjs`: passed with zero diagnostics for current source plus owned tests/scripts. This scoped TypeScript compiler-API command resolves test dist imports to current src without emitting files, and excludes isolation-worker roots. The coordinator still owns ordinary compiled-declaration test checking after its build.
- `./node_modules/.bin/eslint src test scripts/demo.ts scripts/migrate.ts --ignore-pattern test/database-isolation.test.ts`: passed; subsequent repository/native-test/demo scoped lint checks also passed after final edits.
- Scoped `prettier --check` across the changed native source, tests, scripts, active docs and service artifacts passed; later edited files were formatted explicitly and checked again.
- `node scripts/check-database.ts`: passed, MongoDB, 127 source files and 511 locked packages after coordinator lock regeneration.
- `node scripts/check-architecture.ts`: passed, 127 files, 478 imports and 13 features with acyclic file/type/feature graphs.
- Changed-document relative-link check passed.

No runtime test, application build, database execution, browser check, native device check or deployment ran in this worker. Coordinator runtime acceptance is pending. Initial transient noEmit diagnostics from concurrent logging/startup integration were resolved by the coordinator; they are not suppressed. The new native regression suite covers method groups, projection/population shapes, indexed IDs, bounded cursor traversal, shared-session rollback, createMany validation/save semantics, bulk partial failure/validation and upsert rename behavior.

## Coordinator execution setup

1. Perform independent selected-dependency offline install/build and ordinary checks.
2. Prepare a task-owned capped Mongo replica set and wait for PRIMARY readiness.
3. Run `DATABASE_URL=<isolated-url> node scripts/migrate.ts` twice to establish preserving setup for identity, notes, media and push.
4. Run database suites serially with `TEST_DATABASE_URL=<isolated-url>` against the fresh build, then assembled HTTP/protocol and demo/browser acceptance, including restarting the demo against the same DB.
5. Keep fake/local/provider/device/deployed results separate. External Firebase/cloud/device/deployment/advanced-mode acceptance remains pending.

## File inventory

The example was already untracked at dispatch. The following is the exact worker-written inventory (including formatting-only writes); substantive edits are described above. Concurrent coordinator-only new files are not attributed here.

```text
.env.development.example
.env.production.example
.env.test.example
Makefile
README.md
docs/CODE-WALKTHROUGH.md
docs/IMPLEMENTATION-CONTRACT.md
docs/MONGODB-NATIVE-REPORT.md
docs/PROJECT-TREE.md
docs/VERIFICATION.md
docs/agent-prompts/README.md
docs/architecture.md
docs/base-repository.md
docs/delivery.md
docs/identity.md
docs/operations.md
docs/storage.md
ops/Dockerfile
ops/Dockerfile.dockerignore
ops/compose.development.yml
ops/deploy/coolify/README.md
ops/deploy/coolify/compose.yml
ops/local/compose.orca.example.yml
ops/local/services.env.example
package.json
scripts/demo.ts
src/app.custom.module.ts
src/app.module.ts
src/core/auth/enrollment-cutoff.ts
src/core/auth/principal-authority.ts
src/core/auth/principal.ts
src/core/config/app-config.ts
src/core/config/load-config.ts
src/core/database/base-repository.ts
src/core/database/database-errors.ts
src/core/database/database.ts
src/core/database/mongo-database.ts
src/core/database/repository-types.ts
src/core/database/transaction-context.ts
src/core/diagnostics/diagnostic-events.ts
src/core/errors/application-error.ts
src/core/http/current-principal.decorator.ts
src/core/http/http-error.filter.ts
src/core/http/http-security.module.ts
src/core/http/openapi-security.ts
src/core/http/parse-input.ts
src/core/http/principal.guard.ts
src/core/http/record-request.ts
src/core/mail/mail-submitter.ts
src/core/realtime/event-publisher.ts
src/create-reference-app.ts
src/generated/vcli-app.module.ts
src/initialize-identity-database.ts
src/main.ts
src/modules/accounts/account.entity.ts
src/modules/accounts/account.module.ts
src/modules/accounts/account.service.ts
src/modules/accounts/current-account.controller.ts
src/modules/diagnostics/diagnostic-reader.service.ts
src/modules/diagnostics/diagnostic-reader.ts
src/modules/diagnostics/diagnostic-schema.ts
src/modules/diagnostics/diagnostics-mcp.service.ts
src/modules/diagnostics/diagnostics.module.ts
src/modules/diagnostics/diagnostics.service.ts
src/modules/health/health.controller.ts
src/modules/identity/action-tokens.controller.ts
src/modules/identity/action-tokens.service.ts
src/modules/identity/argon-passwords.service.ts
src/modules/identity/change-password.controller.ts
src/modules/identity/change-password.service.ts
src/modules/identity/credential-ports.ts
src/modules/identity/firebase-enrollment.service.ts
src/modules/identity/firebase-identity.controller.ts
src/modules/identity/firebase-token-verifier.service.ts
src/modules/identity/identity-authority.service.ts
src/modules/identity/identity-inputs.ts
src/modules/identity/identity-rate-limits.service.ts
src/modules/identity/identity-request-bodies.ts
src/modules/identity/identity.entity.ts
src/modules/identity/identity.module.ts
src/modules/identity/identity.service.ts
src/modules/identity/jose-access-tokens.service.ts
src/modules/identity/local-credentials.service.ts
src/modules/identity/local-identity.controller.ts
src/modules/identity/rate-request.ts
src/modules/identity/secret-facts.ts
src/modules/installations/installation.entity.ts
src/modules/installations/installation.module.ts
src/modules/installations/installation.service.ts
src/modules/mail/capture-mail.service.ts
src/modules/mail/mail.module.ts
src/modules/mail/mail.service.ts
src/modules/mail/render-message.ts
src/modules/mail/smtp-mail.service.ts
src/modules/media/capabilities.module.ts
src/modules/media/media-state-store.ts
src/modules/media/media-storage-mapping.ts
src/modules/media/media-transitions.ts
src/modules/media/media.controller.ts
src/modules/media/media.entity.ts
src/modules/media/media.module.ts
src/modules/media/media.repository.ts
src/modules/media/media.service.ts
src/modules/media/mongo-media-state-store.ts
src/modules/notes/notes.controller.ts
src/modules/notes/notes.entity.ts
src/modules/notes/notes.module.ts
src/modules/notes/notes.service.ts
src/modules/push/apns-payload.ts
src/modules/push/apns-push.service.ts
src/modules/push/fcm-push.service.ts
src/modules/push/mongo-push-state-store.ts
src/modules/push/push-state-store.ts
src/modules/push/push-storage-mapping.ts
src/modules/push/push-transitions.ts
src/modules/push/push.controller.ts
src/modules/push/push.entity.ts
src/modules/push/push.module.ts
src/modules/push/push.repository.ts
src/modules/push/push.service.ts
src/modules/realtime/centrifugo-api.service.ts
src/modules/realtime/centrifugo-connection.service.ts
src/modules/realtime/centrifugo-proxy.controller.ts
src/modules/realtime/native-ws.service.ts
src/modules/realtime/protocol-validation.ts
src/modules/realtime/realtime-ticket.service.ts
src/modules/realtime/realtime.controller.ts
src/modules/realtime/realtime.module.ts
src/modules/realtime/realtime.service.ts
src/modules/realtime/socket-io.service.ts
src/modules/review/review-page.ts
src/modules/review/review.controller.ts
src/modules/review/review.tokens.ts
src/modules/sessions/refresh-sessions.service.ts
src/modules/sessions/session-facts.ts
src/modules/sessions/session-issuer.service.ts
src/modules/sessions/session-management.service.ts
src/modules/sessions/session-policy.ts
src/modules/sessions/session.entity.ts
src/modules/sessions/session.service.ts
src/modules/sessions/sessions.controller.ts
src/modules/sessions/sessions.module.ts
src/modules/storage/local-storage.service.ts
src/modules/storage/private-filesystem.ts
src/modules/storage/s3-storage.service.ts
src/modules/storage/storage.entity.ts
src/modules/storage/storage.module.ts
src/modules/storage/storage.service.ts
test/base-repository-native.test.ts
test/base-repository.test.ts
test/config.test.ts
test/database-isolation.test.ts
test/delivery-composition.test.ts
test/delivery-persistence.test.ts
test/delivery-smtp.test.ts
test/delivery.test.ts
test/dependency-rules.test.ts
test/diagnostics-mcp.test.ts
test/diagnostics-reader.test.ts
test/e2e/reference.test.ts
test/helpers/memory-media-state-store.ts
test/helpers/memory-push-state-store.ts
test/helpers/mongo-fixture.ts
test/helpers/once-socket.ts
test/helpers/probe-repository.ts
test/identity-database-errors.test.ts
test/identity-firebase-errors.test.ts
test/identity.test.ts
test/media-persistence.test.ts
test/media.test.ts
test/notes-persistence.test.ts
test/notes.test.ts
test/realtime-centrifugo.test.ts
test/realtime-module.test.ts
test/realtime-protocol.test.ts
test/realtime-tickets.test.ts
test/startup-errors.test.ts
```

Removed or moved out of application source:

```text
src/core/database/memory-database.ts
src/core/database/memory-repository.ts
src/core/database/mongo-repository.ts
src/core/database/postgres-database.ts
src/core/database/postgres-repository.ts
src/modules/media/memory-media-state-store.ts
src/modules/media/postgres-media-state-store.ts
src/modules/push/memory-push-state-store.ts
src/modules/push/postgres-push-state-store.ts
migrations/001-identity.sql
migrations/initialize-identity.mjs
```

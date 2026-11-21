# Native single-database reference contract

The owner authorized implementing the fuller BaseRepository method catalog and clarified that the database is chosen once at project initialization. Each expected-output project must contain exactly one native database implementation. This supersedes the combined catalog, runtime driver switching and portable scalar RepositoryAdapter/RepositoryDefinition design. This records the native-reference task scope. The owner subsequently authorized CLI implementation; the selected-database rules continue to apply.

- examples/reference-api is the MongoDB/Mongoose application.
- examples/reference-api-postgres is the PostgreSQL/Drizzle + pg application.
- Both retain the approved flat entity/service/module structure, one class per file, strict TypeScript, single quotes, explicit Nest injection and acyclic runtime/type/feature dependencies.
- No cross-project source imports, runtime database union/selector, unselected database schemas/services/direct dependencies, or selectable memory database. Test doubles stay under test helpers only and never appear in app configuration.
- Native filters, updates, projections, sort/order, population or SQL joins and transaction types belong to the selected implementation. Do not design another universal query language.

## Expanded repository behavior

Provide create/createMany; findById/findByIdOrThrow/findOne/findOneOrThrow/findMany; exists/count/distinct; findWithPagination; updateOne/updateMany/findByIdAndUpdate/findOneAndUpdate; explicit upsert; deleteOne/deleteMany/findByIdAndDelete/findOneAndDelete; bounded async iteration for large results. Use precise names and avoid find/count aliases. Mongo includes typed aggregate, bulkWrite and native population. PostgreSQL supplies typed SQL aggregation/joins, explicit conflict-target upserts and appropriate batch operations using existing Drizzle/pg facilities, not fake Mongo APIs.

Query options cover selected fields, sorting, limits and the caller's existing transaction/session. Returns are plain records with honest projection types; OrThrow controls absence errors, write summaries differ clearly from returned records. Bounds/stable unique tie-breakers apply to pagination and iteration. Empty-filter bulk updates/deletes require an explicit allowAll opt-in. Use indexed ID access, explicit conditional writes and one transaction for multi-record invariants. Preserve existing documented atomic guarantees; document native bulk validation/middleware/partial outcomes explicitly. External effects stay outside retryable callbacks. Protected native model/db is available for feature-specific queries. Do not wrap every library function or add speculative services.

## Ownership

Mongo worker owns all files in examples/reference-api except package-lock.json, node_modules, dist, ignored var, scripts/database-isolation-rules.ts, scripts/check-database.ts and test/database-isolation.test.ts. It may edit package.json to remove unselected dependencies and wire check:database; coordinator owns lock resolution/install and final build. Change all DB-dependent owners, schemas, release setup, fixtures/config/env/demo/Compose/deploy docs so the app is actually Mongo-only. Preserve core auth/session/media/push behavior. No edits to sibling or parent documentation.

PostgreSQL worker owns the equivalent files in examples/reference-api-postgres with the same exclusions. Make it genuinely PostgreSQL-only throughout, with native schemas and BaseRepository and no Mongoose imports. It may change package.json; coordinator handles lock/install/build. Preserve HTTP and security contracts. No edits to main Mongo example or parent docs.

Isolation worker owns only the six database-isolation checker/test files named above across both examples. Inspect current packages/source read-only while implementations change. Each script is baked to its own selected database, checks source and declared/locked dependencies and rejects adapter unions/runtime selection/unselected provider source. Provide negative fixtures that establish rejection. Do not rewrite the existing circular-dependency checker; report an issue to coordinator if needed. Announce package script integration names.

Coordinator owns parent docs/AGENTS, comparison README, prompt files here, lock resolution, independent offline installs, shared test infrastructure and final serial compile/static/real database/HTTP/protocol/browser acceptance. A temporary ignored PostgreSQL node_modules symlink reuses the existing installation for worker typechecks; coordinator will replace it with its own selected-dependency install after workers settle.

## Verification and boundaries

No worker installs/downloads, services/browser, builds/dist emission, worktrees, commits, publication, provider provisioning or deployment. Scoped noEmit/lint/format are allowed inside the owned app; tests importing dist need coordinator rebuild first. Use current official docs/installed type definitions. Do not delete security regressions to get compilation: adapt fixtures to the selected real database and mark missing test infrastructure as explicit skips/setup requirements. Use one TEST_DATABASE_URL for native real-database fixtures where practical; app DATABASE_URL remains separate. No fake successful methods, throw-todo stubs, skipped implementation or proof by snapshots alone. Nonzero checks must be fixed or reported as an actual blocker.

Coordinator will initialize isolated capped cached database containers and run both apps serially. Prior combined-app results are historical, not current native-output evidence. External Firebase/cloud/device/deployed/advanced-mode acceptance stays pending. Follow all host disk/download/resource rules; no new download batch above 500 MB without owner authorization. User asked to do all implementation; do not seek approval for already-authorized routine changes.

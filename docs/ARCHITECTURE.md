# Shared architecture and implementation contracts

This is the proposed engineering baseline. [DECISIONS](DECISIONS.md) records choices still needing resolution; [PRODUCT](PRODUCT.md) preserves full scope. Examples are design shapes, not existing code or a finalized public SDK.

## Two separate systems

**VCLI** runs during development: parse a request, validate project choices, resolve recipes, build a deterministic change plan, apply safe writes, invoke existing tools, and report evidence.

**The generated application** is ordinary NestJS source. It runs without the VCLI executable. Nest owns build/watch/runtime composition. A narrow versioned authentication library can supply security mechanics; that does not require a VCLI runtime framework or generic service locator.

Start with a single TypeScript CLI package and internal engine/recipe modules. Split into workspace packages only for real distribution boundaries; the auth runtime package is the first likely separate package in Phase 03. Do not create ten publishable packages before any working generator.

Illustrative toolkit layout as features arrive:

```text
src/
  commands/              # CLI parsing and presentation
  engine/                # project state, recipes, plans, safe writes
  recipes/               # core and implemented capability recipes
  generators/            # feature/code scaffolds
templates/               # ordinary source/config/doc templates
tests/                   # engine fixtures and generated-app acceptance
examples/                # small reproducible generated fixtures
docs/                    # maintained contracts and decisions
phases/                  # implementation plan/status
```

## Generated application ownership

```text
src/
  main.ts
  app.module.ts
  app.custom.module.ts              # developer-owned integration point
  generated/                        # tool-owned registration only
    vcli-app.module.ts
  core/                             # shared config/auth/HTTP/database mechanisms
    database/
      base-repository.ts
      database.ts                   # selected native connection only
      repository-types.ts           # shared CRUD/pagination types
  modules/
    orders/
      order.entity.ts               # entity and selected database definition
      order.service.ts              # inherits shared CRUD; adds feature methods
      order.module.ts               # Nest providers/exports
      order.controller.ts           # only when HTTP endpoints are requested
```

The owner approved this compact structure after reviewing the layered reference. Generate only selected database implementations and useful files. Two independent hand-built references demonstrate MongoDB-only and PostgreSQL-only output; each contains only its selected implementation. `vcli init` selects one database and the chosen capabilities before any files are written. BaseRepository uses its selected native model/database directly. There is no Database union, runtime driver branch, RepositoryAdapter or dual-driver entity definition. Test doubles belong in tests rather than a selectable application memory backend. Services may use their selected database's types for specialized operations. There are no mandatory domain/application/adapters/ports/public folders or interfaces for every helper.

One handwritten class per file applies to DTOs, controllers, services, repositories, modules and models. Related types, schemas, constants and helpers may share a cohesive file. Reuse the base repository for common CRUD; preserve owner-specific conditional/transactional operations where generic updates would weaken behavior. Controllers validate inputs, enforce access and call feature service methods. Generic inherited CRUD is not automatically exposed through HTTP.

Each feature owns its schema and persistence. Other features import deliberately exported services, not foreign model handles. Core imports no feature. File imports (including type-only edges) and feature dependency graphs must be acyclic. Put multi-feature orchestration above its dependencies or extract genuinely neutral shared facts. Never use forwardRef, ModuleRef, a locator, @Global, dynamic loading or barrel indirection to bypass this rule. Checks reject cycles and unavailable imports before builds.

A feature scaffold must not invent business policy, permissive authorization or fake successful methods. Input, output, actor and persistence rules are explicit. Configuration validation, transaction coordination, pagination, authentication and safe errors are shared mechanisms; provider-specific behavior stays in focused implementation services.

### Nest registration is not provider visibility

`app.module.ts` imports the generated integration module once and preserves the custom integration seam. VCLI can regenerate its own registration module while developers customize the rest.

Importing two modules at the root does **not** make one module's providers available inside the other. Capability modules export explicit providers; new consumer templates import those modules explicitly. For an existing developer-owned consumer, generate integration instructions or a bounded explicitly planned edit through its documented seam. Report manual integration as pending. Do not mask missing dependency injection with global modules or arbitrary AST rewrites.

## Recipe contract

A curated registry is sufficient initially. New recipes may require one explicit registration import. Do not promise zero core changes for a fundamentally new capability; promise no provider-specific branches throughout existing consumers.

Each implemented recipe declares:

- Stable ID and version, validated options, supported toolchain range.
- Capabilities provided/required; exclusive family or allowed multi-provider purpose.
- Dependencies and conflicts, with deterministic resolution and clear missing-choice errors.
- New files, tool-owned registrations, package dependencies, conditional config, documentation, and checks.
- Relevant optional service requirements and provider acceptance limits.

Use a simple dependency DAG, reject cycles and conflicting selections, and preserve compatible installed choices. Presets select recipes; they are not separate copies of the same starter. Capability flags describe actual independent guarantees, such as conditional object creation or retained realtime replay; avoid one arbitrary numeric rank that falsely orders unlike guarantees.

Small shared service contracts are introduced only for real consumers or interchangeable implementations, such as mail, storage and realtime. Ordinary Nest providers register the selected implementation. SDK mechanics stay in their focused services. Typed outcomes distinguish accepted/rejected/unavailable/unknown; having an implementation does not establish provider acceptance.

No arbitrary external recipe execution initially. Installing an npm package can execute code through package scripts; do not describe third-party installation as sandboxed merely because templates are declarative.

## Project configuration and state

Illustrative desired configuration; exact schema is versioned during implementation:

```json
{
  "schemaVersion": 1,
  "project": { "name": "example-api", "packageManager": "pnpm" },
  "architecture": "owner-modular",
  "capabilities": {
    "database": { "recipe": "database-mongodb", "options": {} },
    "auth": {
      "recipe": "auth-firebase",
      "options": { "methods": ["email-password", "google"] }
    },
    "mail": { "recipe": "mail-capture", "options": {} }
  }
}
```

`vcli.json` records nonsecret choices and tunables. Recipe-specific schema validation is composed from the curated catalog. It is not a central hardcoded enum repeated across every command. Exclusive families permit one selection; push may have a purpose-indexed set. Runtime secrets stay in private configuration or secret stores, never here.

`vcli.lock.json` records realized recipe/schema versions, selected generation options, generated ownership/file sets and operation outcomes. Dependency versions still belong in the package manager's lock. The VCLI lock is not proof of runtime reachability or provider readiness.

`.vcli/local/` is ignored operation state: journals, local evidence, private setup metadata, bounded capture data with access restrictions. Do not commit tokens or record raw environments in plans/journals. Managed baselines, if needed for narrow documentation regions, must be nonsecret.

Changing a provider choice manually creates drift until a supported reconciliation plan is applied. Ordinary runtime tunables within an installed provider do not automatically require regeneration. `doctor` checks meaningful registration/dependency/configuration evidence; it does not demand that every developer-owned file retain its original hash. Merged branches require revalidation of the resulting combination.

## Mutation lifecycle

1. Discover a supported project and validate choices/options and installed state.
2. Resolve requirements/conflicts; reject missing decisions without guessing from registry order.
3. Produce a plan with versions, touched paths, expected absence/content hashes, package actions and manual/external steps.
4. A dry run writes nothing and executes no install/migration/provider action. Saving a plan is a separate explicit write.
5. Apply under a project operation lock, recheck content preconditions, reject path/symlink escapes, stage source changes and journal writes.
6. Record source application, dependency installation and checks separately. An install failure cannot be reported as a complete capability.
7. Recovery restores only task writes still matching recorded post-images. Later user edits survive. Unsupported source shapes or missing anchors produce an actionable conflict.

Two primary ownership classes suffice: tool-owned generated files and scaffold-once developer-owned source. Narrow marked documentation sections can be managed within a developer file. An ordinary `add` never re-renders developer business source. Changes across files, package installation and remote services are not one atomic transaction.

Use parsed JSON/YAML or controlled templates for owned structures, not regex on arbitrary code. Use syntax-aware edits only when necessary and explicitly bounded. The engine choice cannot make arbitrary customized code safely rewritable.

## Command contract

Initial commands are `init`, `add`, `g`, `inspect`, `doctor`, `check`. `init` supports a new directory or a verified empty current directory; adopting an arbitrary Nest project is deferred. The project pins its local VCLI version; generated instructions invoke that local executable.

Writing commands support preview and explicit noninteractive options. `--yes` accepts documented safe defaults, not unknown security or destructive choices. Missing required selections return a structured error and nonzero exit, never wait indefinitely when stdin is not interactive. `--json` uses a stable schema with status, changes, warnings, pending work and errors; progress belongs on stderr. No secret values in either output stream.

`--skip-install` records installation pending. `inspect` is read-only. `doctor` checks installation/configuration health; network probes are explicit. `check` invokes the project's documented static/behavior checks and names skipped evidence. Do not invent passing checks for code paths that have only a scaffold.

## Data, authentication and side effects

The selected Mongoose or Drizzle/pg BaseRepository provides richer native CRUD/query helpers. Init emits one implementation and only its SDK dependencies. Shared method names do not imply a universal filter language: Mongo uses native filters/operators/populate, while PostgreSQL uses typed SQL conditions/joins and explicit upsert conflict targets. Owner services retain specialized atomic operations. UUIDv4 is the proposed public identity. Shared page pagination returns data, totalCount, totalPages, currentPage, hasNext and hasPrev, with bounded limits and stable ID ordering. Endpoint-specific ordering remains explicit; cursor pagination is added only for a real requirement. Pagination is not a synchronization log.

Conditional updates handle single-record invariants. Operations spanning records use one explicit coordinator and opaque transaction context passed to all required participants; adapter-local checks bind it to the correct connection/database. Never fall back to sequential writes or implicitly start a second independent transaction. Mongo transaction recipes require the appropriate topology. Retry callbacks contain no external side effects.

Keep provider/network calls outside retryable database transactions. Commit durable effect intent before dispatch where the workflow requires reliable asynchronous effects; authorization reads, verification and preparation may precede the accepting database commit. Use a purpose-specific outbox/idempotent dispatch process only where required, not queues universally. A timeout after possible acceptance is an unknown outcome, not proof of failure. Business operation identity, bounded retries, and provider idempotency are explicit. Exactly-once delivery is not assumed.

Identity, account, session, installation, connection, and push destination have different lifecycles. Firebase proof is not a physical device credential. Local access JWTs do not independently establish current session authority. Phase 03 defines revocation/refresh transitions; Phase 04 consumes them, and Phase 05 fences notification ownership.

## Environment and services

Generate `.env.development.example` and `.env.production.example` with safe placeholders, conditional required fields and instructions. Private `.env.development`/`.env.production` files are ignored, never populated from another project, and preserved during later additions. Explicit runtime environment takes precedence over a deliberately selected private file, then documented safe defaults. Production may use injected secrets entirely; it must never quietly load development credentials or capture adapters.

Build one conditional configuration model for validation, examples, documentation and deployment mapping. Existing private files are not regenerated. Additions report newly needed keys without exposing values. Credential JSON, JWT keys, tokens, action links and signed URLs stay out of logs, images, plans and example files.

Recipes contribute a small service description: image/version, command, ports, health, resource needs, secrets, persistence, ingress and release requirements. Dev wrappers delegate to supported service tooling and Nest scripts. Deploy renderers translate this into platform-specific artifacts and reject unsupported profiles. Operators are separately authenticated and invoked. No VCLI supervisor or continuous reconciler is required.

## Observability, verification and maintenance

Baseline logs are structured and redacted, with request/operation/run correlation where available. Vector collects, Logdy views, retained evidence preserves, and MCP reads; none implies the others' guarantees. The app remains useful with optional viewers stopped. Diagnostic content is untrusted data, and a same-user subprocess has the user's permissions unless actually isolated.

Generate short feature-aware README/AGENTS guidance and preserve user sections. Enforce import direction, class/file conventions, strict types and tests through ordinary tooling. Do not claim universal agent instruction-file behavior without version-specific checks.

Each recipe owns compatibility, regression evidence and a patch path from its first release. Versioned libraries enable security updates but do not install them in deployed apps automatically. Upgrades use dependency changes, managed regeneration, supported codemods and manual review where needed. Phase 09 proves this on customized projects; it does not postpone security responsibility until then.

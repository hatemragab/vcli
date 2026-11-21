# VCLI contributor and coding-agent instructions

This is the standalone VCLI repository. It is not the SuperUp backend. The delivery contains planning documentation and owner-reviewed hand-built single-database reference applications under `examples/`. The owner has now authorized CLI implementation through all documented phases; keep generated-app evidence separate from reference evidence. Read [START-HERE.md](START-HERE.md), [the architecture](docs/ARCHITECTURE.md), [the decisions](docs/DECISIONS.md), and the selected phase before work. The reference is an expected-output review surface; keep its evidence separate from generator phase completion.

## Scope and authority

- Follow the user's current authorized task. The owner authorized standalone repository setup, Orca registration, and the initial private GitHub publication. The owner subsequently authorized full CLI source implementation through all phases. Provider provisioning, npm publication, production migrations and deployment still require their own authorization.
- When implementation is authorized, complete the selected scope and phase gates. A phase boundary is not an automatic requirement to ask again if the user already authorized continuing.
- Use [STATUS.md](phases/STATUS.md) and the selected phase's tasks/acceptance files. Keep incomplete work and external setup visible. Never mark a test or phase passed without its evidence.
- The current planning baseline is in `docs/DECISIONS.md`. Record consequential deviations instead of silently changing provider scope or architecture. Resolve routine details within the authorized scope.
- Historical material under `docs/archive/` is background, not active instructions. No SuperUp milestone board, Makefile, directory layout, product rule, credentials, or private source is required.
- Use the existing checkout. Do not create a worktree unless the user requests one. Preserve unrelated changes.

## Coding policy

- Apply SOLID: cohesive responsibilities; extension through capability adapters; preserved contract behavior; small consumer-specific interfaces; composition of infrastructure at the edge.
- Use one handwritten class per file, including DTO classes, controllers, services, repositories, models, and modules. Cohesive types, schemas, constants, and pure helpers may share a file. Preserve tool-owned generated files.
- Use strict TypeScript, kebab-case files, UpperCamelCase types/classes, lowerCamelCase members, single quotes, and the selected formatter. Prefer `unknown` and validation at untrusted boundaries; narrowly justify unavoidable library typing exceptions.
- Use the owner-approved compact NestJS structure: flat entity/service/module files, with controllers/DTOs and focused implementation services only where needed. Data services inherit shared repository behavior. No mandatory domain/application/adapters/ports/public folders or redundant wrappers.
- Database selection happens once during init. Each generated-style app contains only its selected database implementation, schemas, direct dependencies and native BaseRepository. No runtime DB selector/union, RepositoryAdapter, dual-driver metadata or production memory recipe. The two reference variants are independent projects, not profiles imported into one app.
- Controllers validate/map transport input and use verified request identity; feature services own cohesive operations. Share configuration, database mechanics, transactions, pagination, authentication and HTTP errors under core. Normal Nest providers select implementations.
- Each feature controls its persistence and exposes deliberate injectable services. Do not import another feature's raw models. Circular dependencies, including type imports and feature-level cycles, are prohibited. Never use `forwardRef()`, `ModuleRef`, `@Global`, lazy imports or a locator to conceal them. Core imports no feature; multi-feature coordination belongs above participants.
- Validate and map HTTP input explicitly. Feature services may use inherited repository operations internally; controllers must not expose unrestricted database filters or foreign model handles.
- Use conditional writes when they preserve the invariant; otherwise coordinate an explicit transaction. Participants share the same opaque transaction context and do not commit independently. Keep external I/O outside retryable database callbacks.
- Reuse existing mechanisms. Create interfaces at genuine boundaries and only active layers; do not generate empty architecture for appearance.

## Generator and ownership policy

- Routine generation updates tool-owned composition/configuration files and creates new developer-owned scaffolds. It does not rewrite arbitrary customized business code.
- Validate desired choices against realized project state. Recheck existence/content preconditions for every touched path. Dry runs do not mutate the project or external systems.
- Fail clearly on ownership conflicts, unsupported combinations, unsafe paths, stale plans, or incomplete installation. Recovery must not reset a repository or overwrite newer edits.
- Source generation, dependency installation, configuration, runtime checks, provider acceptance, and deployment are separate outcomes.
- New projects use their pinned local CLI once installed. Before implementation exists, do not claim proposed VCLI commands are executable.

## Verification and reporting

- Inspect actual package scripts. Use the smallest relevant lint/type/behavior checks for a change. A generator release needs generated-app acceptance, not snapshots alone.
- Follow [VERIFICATION.md](docs/VERIFICATION.md). Separate fake-port, real local database/service, provider, device, and deployed evidence.
- Documentation-only changes need document/link/schema checks, not application builds by default.
- Redact credentials and private content from output, fixtures, plans, logs, and evidence. Never copy production `.env` or provider keys into templates.
- Keep README/agent instructions and affected public contracts current as each capability lands. Generated app guidance includes only selected capabilities.

## Execution host

Apply the current host/user resource and browser policies. Do not assume a Mac, Linux, a connected phone, Docker, a specific absolute path, or a configured provider account. The portable product rules do not grant tool permissions. Host-specific limits belong in contributor-local policy, not every generated application.

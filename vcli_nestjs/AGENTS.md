# VCLI contributor and coding-agent instructions

VCLI is a standalone TypeScript CLI that generates and maintains NestJS applications. Start with the [task-to-file map](START-HERE.md) for the implementation and focused checks. Consult [the architecture](docs/ARCHITECTURE.md), [the decisions](docs/DECISIONS.md), and the relevant capability guide for design and acceptance requirements. Generator acceptance requires evidence from a generated project.

## Working in the generator checkout

- [src/cli.ts](src/cli.ts) registers the command groups in [src/commands/](src/commands/). For a change to generated output, start in [src/recipes/](src/recipes/) and [templates/runtime/](templates/runtime/). Planning, safe writes, and recovery live in [src/engine/](src/engine/).
- Edit the shared authentication runtime in [packages/auth-runtime/](packages/auth-runtime/). The build creates its distribution copy under `runtime-packages/auth-runtime/`.
- Use the Node range and npm version in [package.json](package.json). On a fresh checkout, install from the lockfile with `npm ci --ignore-scripts --no-audit --no-fund`.
- [bin/vcli.mjs](bin/vcli.mjs) loads `dist/cli.js`. Run `npm run build` after source changes before checking the executable or running tests that import `dist/`. From the VCLI NestJS package directory, `node bin/vcli.mjs --help` lists implemented commands.
- For static verification, `npm run check` covers formatting, lint, architecture, and type checks across the CLI and auth workspace. For a focused CLI behavior check, use `node --test test/cli.test.ts`. The full CLI suite uses `npm test`, and the auth runtime suite uses `npm test --workspace @vcli/auth-runtime`.

## Scope and authority

- Follow the user's current authorized task. The owner authorized standalone repository setup, Orca registration, and the initial private GitHub publication. The owner subsequently authorized full CLI source implementation through all phases. Provider provisioning, npm publication, production migrations and deployment still require their own authorization.
- When implementation is authorized, complete the selected scope and phase gates. A phase boundary is not an automatic requirement to ask again if the user already authorized continuing.
- Use [CLI verification](docs/CLI-VERIFICATION.md) and the selected capability guide. Keep incomplete work and external setup visible. Never mark a check as passed without its evidence.
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
- Use the pinned local CLI when working inside a generated project.

## Verification and reporting

- Inspect actual package scripts. Use the smallest relevant lint/type/behavior checks for a change. A generator release needs generated-app acceptance, not snapshots alone.
- Follow [VERIFICATION.md](docs/VERIFICATION.md). Separate fake-port, real local database/service, provider, device, and deployed evidence.
- Documentation-only changes need document/link/schema checks, not application builds by default.
- Redact credentials and private content from output, fixtures, plans, logs, and evidence. Never copy production `.env` or provider keys into templates.
- Keep README/agent instructions and affected public contracts current as each capability lands. Generated app guidance includes only selected capabilities.

## Execution host

Apply the current host/user resource and browser policies. Do not assume a Mac, Linux, a connected phone, Docker, a specific absolute path, or a configured provider account. The portable product rules do not grant tool permissions. Host-specific limits belong in contributor-local policy, not every generated application.

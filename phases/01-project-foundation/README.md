# Phase 01 — Project foundation

**Status: Planned. Implementation has not started.** This phase describes proposed implementation work; this documentation is not evidence that a CLI or generated application exists.

Read [START-HERE](../../START-HERE.md), [product scope](../../docs/PRODUCT.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Track progress in the [phase status board](../STATUS.md), execute [TASKS](TASKS.md) in order, and retain evidence against [ACCEPTANCE](ACCEPTANCE.md).

## Outcome and entry conditions

Create a small standalone TypeScript CLI that initializes a readable Nest application without a database, authentication, mail, realtime, or provider account. A developer can inspect selections, diagnose local setup, and run the application using its normal package scripts. VCLI is a development dependency, not its runtime launcher.

Enter after Phase 00 records the supported toolchain and verifies the proposed configuration/validation approach, including Zod integration through a compatible native Nest pipe. Exact dependency versions must come from that recorded decision, not this document or an unpinned global installation. These phases are implementation plans, not additional owner approvals of technologies or external actions.

## Scope and contracts

Use one CLI package with a command parser, project reader, a curated recipe registry, and a deterministic dependency DAG. Foundation is the first recipe. Do not add Schematics, a general solver, a marketplace, or machinery for rewriting arbitrary customized TypeScript. Register known recipes explicitly; reject dependency cycles, unknown options, and unresolved required choices.

`vcli.json` records developer-editable desired selections and schema version. `vcli.lock.json` records the realized blueprint/recipe versions, source/dependency/check state, and provenance of specifically managed files. It is not a second package-manager dependency lock. Keep secret values, private environment hashes, and unrelated developer-file fingerprints out of committed metadata. An inspection result distinguishes selected, source-created, dependencies-installed, and verified; none implies the next.

Initialize only a new directory or an empty project directory. Define emptiness explicitly, including whether an existing `.git` directory is permitted; preserve it if permitted. A nonempty destination is a conflict, never a request to adopt or clean an existing application. Resolve the destination within the intended root and reject escaping paths or symlink traversal before writes. Identifiers are validated data, not shell fragments.

The generated application uses strict TypeScript, one class per handwritten class file, ordinary Nest modules, explicit imports, bounded input/config validation, safe errors, structured logging, request correlation, and graceful shutdown. Configuration fails safely when invalid and never silently substitutes development settings in production. `GET /health/live` establishes process liveness; `GET /health/ready` establishes only the configured foundation's readiness. Neither advertises nonexistent database/provider health.

## Generated files and ownership

| Area | Ownership and purpose |
| --- | --- |
| `src/main.ts`, `src/app.module.ts` | Generated once, then developer-owned bootstrap and root composition. |
| `src/app.custom.module.ts` | Generated once, developer-owned extension module with explicit imports/exports. |
| `src/generated/vcli-app.module.ts` | Tool-owned, deterministic registration of selected infrastructure modules. |
| `src/platform/config/`, `http/`, `logging/`, `health/` | Readable foundation code; ownership is recorded per managed file, not inferred from every directory. |
| `README.md`, `AGENTS.md`, architecture guide | Short selected-project guidance with explicit managed sections and developer extension areas. |
| Environment examples and `.gitignore` | Document safe names/defaults; ignore private environments, local state, and diagnostic artifacts. |
| Package scripts and lockfiles | Pin supported local tooling; distinguish CLI metadata from the package manager's lockfile. |

The root imports generated and custom modules explicitly. Root-level registration does not make providers available to sibling feature modules. No root `@Global()` module, service locator, or dynamic folder scan should conceal that boundary. Future generators must declare consumers' required module imports.

Private environment creation is a separate explicit setup choice that preserves existing values. Do not generate credentials, copy machine settings, contact accounts, start containers, or create Git commits during source generation. The initial blueprint has no auth runtime dependency; its narrow shared runtime package is introduced with identity in Phase 03.

## Command behavior

Proposed commands, to be finalized consistently with Phase 00:

```sh
vcli init sample-api --non-interactive --skip-install
vcli init . --non-interactive --skip-install
pnpm exec vcli inspect --json
pnpm exec vcli doctor --json
```

`init --dry-run` writes nothing, including locks, directories, private files, or plans. Noninteractive mode fails with missing-choice details rather than prompting. Basic `doctor` examines local declared compatibility and configuration names without network/provider probes or a tool installation. JSON output is a stable machine-readable result on stdout; diagnostics use stderr and omit secrets. Package installation is separately requested and reported; source creation alone cannot mark it successful.

## Errors, risks, and handoff

Define stable errors for invalid options, unsupported toolchain/schema, nonempty destination, unsafe path, missing input, invalid configuration, and dependency-install failure. Include the failing stage and an actionable next step without dumping environment values. Cleanup affects only known task-created unchanged files, never an unrelated directory.

The main risks are an overgrown default starter, misleading readiness, and accidental global provider visibility. Acceptance must demonstrate the small dependency footprint and explicit composition. Identify the release/security-patch owner now, including responsibility for copied foundation code; Phase 09 improves maintenance tooling rather than beginning maintenance responsibility.

Exit only after the acceptance record identifies the generated revision, checks actually run, and remaining limitations. Continue with [Phase 02](../02-safe-generation/README.md); its lifecycle hardening must also cover `init`. See [Phase 09](../09-upgrades-extensibility/README.md) for later maintenance of this blueprint.

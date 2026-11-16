# Phase 02 — Safe incremental generation

**Status: Planned. Implementation has not started.** The commands and contracts below describe future behavior, not existing tools or passing checks.

Start with [START-HERE](../../START-HERE.md), [product scope](../../docs/PRODUCT.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Use [TASKS](TASKS.md), [ACCEPTANCE](ACCEPTANCE.md), and the [status board](../STATUS.md).

## Outcome and boundary

Extend a customized [Phase 01](../01-project-foundation/README.md) project without overwriting business source. Add development mail capture and generic scaffolding through initialization's planner, before authentication or external providers depend on it.

Use the curated registry and explicit dependency DAG. A recipe declares options, provided/required capabilities, cardinality/conflicts, dependencies, generated registrations/files, configuration, documentation, and checks. Existing selections win when compatible; otherwise require a selection or a documented preset. Registry order never chooses a provider. New capability contracts may legitimately require versioned schema changes; “no business-consumer edits for a new adapter” does not mean zero toolkit changes forever.

## Planning, state, and recovery

Read desired configuration and realized state together. If generation-relevant desired choices are unreconciled, stop with the proposed reconciliation; do not mix an uninstalled stack into the existing project. Verify the touched managed registrations/dependencies rather than trusting a lock entry alone. Do not inventory or fingerprint every developer-owned file.

A deterministic plan contains its schema/tool/recipe versions, operation identifier, requested changes, dependency actions, and preconditions for each touched path. Creates require expected absence; replacements require expected nonsecret bytes or a content hash. Resolve paths and existing symlink ancestors within the project boundary. No untrusted identifier is interpolated into a shell command. Invoke any selected package manager using an executable and separate validated arguments.

Preview makes no writes, including lock files, journals, temporary directories, or saved plans. An explicitly requested save-plan operation is different and must disclose its output. Apply checks preconditions again, stages bounded changes, and journals the operation under ignored local state. A project operation lock prevents concurrent VCLI writers; content preconditions still detect ordinary editor changes. Unsupported edited source shapes or touched managed files cause a conflict, never an attempted universal merge.

Record source, installation, and check outcomes separately. Inspect an interrupted journal before another mutation. Resume compatible steps or recover writes only when current bytes equal the recorded output. Preserve later developer changes and report manual recovery. This is not an atomic transaction across filesystem, installation, databases, and networks.

## Composition and generated files

Ordinary additions update tool-owned registration/composition files, validated configuration, dependency declarations, and owned documentation sections. Templates create developer-owned modules once; subsequent generation does not rewrite them. Structured JSON edits preserve unrelated keys. Managed provenance covers the relevant owned files/sections; temporary content preconditions cover any explicitly planned existing-file edit.

Keep `src/generated/vcli-app.module.ts` and the developer-owned custom integration module introduced in Phase 01. New feature templates declare required capability imports explicitly. Installing a mail module at the application root does not expose its provider inside a sibling feature. For an existing customized module, use its documented custom integration point or show the required manual explicit import; do not add `@Global()` or perform arbitrary AST surgery to hide missing wiring. Report a required manual step as pending, not complete integration.

Proposed generator forms:

```sh
pnpm exec vcli add mail --driver capture --dry-run
pnpm exec vcli add mail --driver capture --skip-install
pnpm exec vcli g feature orders
pnpm exec vcli g command confirm-order --feature orders
pnpm exec vcli g query list-orders --feature orders
pnpm exec vcli g controller orders
pnpm exec vcli check
```

Match the shared command contract. DTO/service/repository/gateway generation needs ownership/layer context and installed capabilities. Missing database/realtime support is an unmet requirement, not permission to install later recipes.

Name-only generation produces a compiling, unfinished, unexposed scaffold. It cannot invent business invariants, permissive authorization, CRUD routes, or passing business tests. Exposure needs input/output, actor/authorization, and operation contracts. Structural checks establish generation safety, composition, compilation, and dependency boundaries only.

## Development capture mail

Add a small consumer-facing mail submission contract and a capture adapter with an awaited, typed `captured` outcome. Captured is neither SMTP acceptance nor inbox delivery. It needs no external credentials or network. Bound message size/count/retention, keep captures in ignored project-owned local/test storage, and provide a test-only inspection API rather than a public debug route. Sensitive action links introduced later must not enter normal logs or generic diagnostic output.

Capture is explicit development/test configuration and must fail production startup when selected there. Phase 03 can use this contract for local-auth verification/reset acceptance without depending on SMTP. Phase 05 later supplies real SMTP behind the same contract. Do not create the auth runtime package in this phase or introduce a mail-library ecosystem before it is justified.

## Errors and risks

Use actionable categories for desired/realized drift, missing capability, cycle/conflict, modified managed file, stale plan, unsafe path, incomplete operation, install failure, unsupported source shape, and forbidden production capture. Never log raw config, shell fragments, message contents, or credentials in error results.

Acceptance addresses silent user-code rewrites, false idempotence after failure, and capture mistaken for delivery. [Phase 09](../09-upgrades-extensibility/README.md) reuses this lifecycle for upgrades without a general merge engine.

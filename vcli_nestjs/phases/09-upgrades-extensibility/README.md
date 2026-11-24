# Phase 09 — Upgrades and extensibility

**Status: Planned. Implementation has not started.** This phase plans maintenance tooling and extension validation. It does not establish any released package, supported upgrade, or provider compatibility.

Use [START-HERE](../../START-HERE.md), [product scope](../../docs/PRODUCT.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Follow [TASKS](TASKS.md), retain [ACCEPTANCE](ACCEPTANCE.md) evidence, and update [STATUS](../STATUS.md) only from reviewed results.

## Outcome and entry conditions

Maintain customized projects through explicit upgrades and prove a new adapter can reuse a capability without changing business consumers. Enter after earlier phases establish supported versions and behavior tests; do not broaden their guarantees.

Security ownership starts with [Phase 01](../01-project-foundation/README.md); Phase 03's single auth runtime package needs patch responsibility immediately. This phase improves inventory, advisories, and migrations without deferring earlier security fixes.

## Three upgrade paths

| Path | Contract |
| --- | --- |
| Runtime dependency upgrade | Update a deliberately selected compatible package and lockfile; review its release/security notes and run affected contracts. Updating VCLI alone does not change a deployed runtime. |
| Managed regeneration | Regenerate only declared tool-owned registration/config/docs files or sections after checking their recorded provenance and current contents. Developer edits cause an actionable conflict. |
| Developer-owned source migration | Apply a small named codemod only to supported shapes with explicit preconditions, or emit a reviewable patch/manual instructions. Never infer ownership from a file suffix or overwrite customized business code. |

Reuse [Phase 02](../02-safe-generation/README.md)'s plan, preconditions, staging, journal, and recovery. Exclude general merging, ejection, arbitrary-source rewriting, remote plugins, and marketplaces; ordinary Nest tooling already runs applications.

Keep initial CLI/blueprint/recipe releases coordinated, record resolved versions, and version the state schema. Independent packages require a distribution need. Unknown versions/migration gaps fail clearly. Never silently select `latest`, rewrite a dependency lock outside its package manager, or substitute a global CLI.

## Source, state, and data safety

`vcli.json` remains developer-owned desired configuration. `vcli.lock.json` records realized versions, applied migration IDs, and managed-file provenance, with source/install/check outcomes distinguished. Upgrade planning reads relevant touched state, not an exhaustive hash inventory of user files. Preserve unknown compatible developer settings and reject incompatible schema changes with an explicit path.

Every planned file create/replacement/deletion has existence and content preconditions. Preview performs no writes, installations, or provider calls. Applying a saved plan rejects intervening edits, including changes to managed files. Installation remains a separate fallible phase; recovering source cannot promise to undo package scripts or external effects. Restore only bytes still equal to the interrupted operation's output.

Database schema/data migrations are a separately declared release action with their own concurrency, recovery, and acceptance requirements. Source rollback is not database rollback. Database or identity-provider switching, destructive feature removal, and cross-provider data conversion are not consequences of editing a driver field or accepting an upgrade. Keep those workflows outside this phase unless separately designed and authorized.

## Extension contract

Add an implementation through a curated registry entry, validated options, adapter/preset, templates/registrations, docs, and contract tests. Business consumers and unrelated providers remain unchanged. Equivalent presets may need no adapter; different semantics require a narrower capability or deliberate contract evolution.

“Extensible” does not promise zero toolkit edits. Adding a genuinely new capability can require a versioned schema, composition, or command update. Resolution remains a deterministic DAG with explicit selections and capability cardinality. No generic solver, dynamic host scan, or unreviewed plugin execution is needed. Explicit Nest imports remain required in generated and custom modules; no global locator should hide an extension's dependencies.

Use an independent adapter exercise with shared typed outcomes and negative cases, not only another filename or an endpoint preset. Mock acceptance proves adapter translation under test conditions, not real provider support. Advertising a new production preset still requires the relevant provider evidence defined by its original capability phase.

## Commands, files, and diagnostics

Proposed commands follow shared CLI conventions:

```sh
pnpm exec vcli inspect --json
pnpm exec vcli upgrade --to RELEASE --dry-run
pnpm exec vcli upgrade --to RELEASE --skip-install
pnpm exec vcli doctor --json
pnpm exec vcli check
```

Affected toolkit areas include the version/support catalog, named migrations, managed-file generators, recipe registry, advisory documentation, and focused fixture tests. Generated projects receive only the planned dependency changes, owned output, metadata, and review instructions. Plans/errors contain no private environment values, credential/private-environment hashes, raw provider payloads, or absolute machine-specific references. Nonsecret source-content hashes and image digests are permitted for preconditions and release identity.

Report unsupported version/schema, missing migration, changed managed file, unsupported codemod shape, stale plan, incomplete prior operation, incompatible dependency, install failure, and verification failure distinctly. Do not convert a partial upgrade into a successful no-op on retry.

## Patch policy, risks, and exit

Maintain a named patch owner, an inventory that distinguishes runtime libraries from copied security-sensitive source, release notes/advisories, affected-version detection, and an explicit remediation route. Inventory identifies known blueprint/recipe components; it does not claim to audit arbitrary custom security code. Copied code needs a patch/migration or manual advisory; a package bump does not fix its copies automatically.

Risks include false compatibility, stale provenance, migrations without fixtures, and runtime libraries absorbing business ownership. Keep migrations small, document support retirement, and test customized projects. Exit requires reviewed upgrade/recovery and independent-adapter evidence; external plugins/distribution remain separate decisions.

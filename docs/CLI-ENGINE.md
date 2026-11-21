# Safe generation engine

The public API is `src/engine/index.ts`; data contracts are in `src/engine/types.ts`. This is local source generation and maintenance machinery. Source, npm installation and selected-project checks have independent `pending`, `completed` and `failed` outcomes. Provider/device/deployment readiness is external evidence and never inferred from these outcomes.

## Command integration

All filesystem APIs are asynchronous. `summarizePlan`, `validatePlan`, `validateConfig`, `validateIdentifier`, `validateToolchain` and `resolveRecipes` are synchronous.

```ts
planInit({ workspaceDir, projectDir, config, catalog }): Promise<GenerationPlan>
planAdd({ projectDir, selections, catalog }): Promise<GenerationPlan>
planScaffold({ projectDir, files, checks?, pending? }): Promise<GenerationPlan>
planUpgrade({ projectDir, catalog, upgrades? }): Promise<GenerationPlan>
summarizePlan(plan): PlanSummary
validatePlan(unknown): GenerationPlan
savePlan(plan, file): Promise<void>
readPlan(file): Promise<GenerationPlan>
applyPlan(plan, { failAfterWrites? }?): Promise<ApplyResult>
inspectProject(projectDir): Promise<Inspection>
doctorProject(projectDir): Promise<Inspection>
installProject(projectDir, { runner? }?): Promise<ExecutionResult>
checkProject(projectDir, { runner? }?): Promise<ExecutionResult>
recoverOperation(projectDir, { operationId?, abandonLock? }?): Promise<RecoveryResult>
```

`selections` is `Record<string, RecipeSelection>`; omitted installed families remain selected. Foundation and required families must be explicit. Recipe IDs, family membership, option validators, dependency cycles, conflicts and duplicate IDs are checked before rendering. Providers/options already realized cannot be switched by `add`. `planScaffold` accepts renderer-supplied new developer-owned files; it cannot edit package metadata, adopt an existing path or rewrite a scaffold.

A `RecipeUpgrade` is `{ recipe, from, to, migrationId }`. A changed recipe version requires exactly one explicitly supplied curated edge. Unknown release gaps are refused. Managed regeneration and dependency declarations reuse the ordinary planner; existing developer source receives manual review instructions. These edges do not execute arbitrary transforms or imply database migration. Recipe authors must separately implement, test and document any specific developer-source migration.

Planning reads relevant metadata and touched managed output only. It never creates a directory, lock, saved plan or journal, invokes a subprocess, installs a dependency or reads private environment files. Use `summarizePlan` for command output; full `GenerationPlan` objects include source file bodies and are private review/apply artifacts. Explicit `savePlan` creates an absent file with mode 0600 and refuses overwriting it. Journals also use mode 0600 in `.vcli/local/operations`; newly created local state directories use mode 0700.

## Ownership and preconditions

`vcli.json` is validated desired state. `vcli.lock.json` records exact realized recipes/options, file ownership, bounded managed package fields, declared checks, pending manual work, migration IDs and separate outcomes. It is not an npm lockfile. Ordinary add fails on unreconciled desired/realized choices and recipe versions.

The generated application owns its root `package.json` version. Normal app version bumps work with generation, installation and checks. The CLI still pins and verifies the separate manifests and files under `tools/vcli` and `tools/vcli-auth-runtime`.

Managed files have content hashes. Scaffold files are created once; later add neither reads nor hashes their bytes. README/AGENTS may contain one `<!-- vcli:managed:start -->` / `<!-- vcli:managed:end -->` region. Its content is protected while surrounding developer text is preserved. Relevant changed managed output and the selected registration module are checked against provenance. The engine does not fingerprint arbitrary user files.

Package JSON uses recorded leaf-field ownership: selected dependencies, scripts and rendered configuration retain exact managed values. New keys merge into parsed JSON, leaving unrelated fields, custom dependencies and scripts intact. New conflicting declarations and moved/changed selected dependencies fail explicitly. No package-manager lock is synthesized by source generation.

Every touched file has an expected-absence or expected-content-hash precondition. Existing-project metadata, package declarations and relevant registration have additional guards. A saved plan rejects intervening edits before source writes. Init supports a new directory or an empty directory with an optional regular `.git` directory. It refuses adoption and rechecks emptiness at apply. The workspace and destination parent must already be regular directories; new nested parent creation is an explicit caller action.

Paths reject traversal, unsafe segments, private environments, `.git`, dependency storage, reserved local state and symlink ancestors/targets. Serialized plan structure, path containment, duplicate paths, ownership and postimage hashes are validated before a project lock is created. No public error contains raw caught exceptions, environment values or file contents.

## Apply, execution and recovery

All mutations serialize with a sibling project lock, allowing the same lock to protect init before its destination exists. A private staged copy and byte-conditional journal precede source mutation. Preconditions and path safety are checked again under the lock and immediately before writes. Fault injection `failAfterWrites` is for acceptance tests. An interrupted journal blocks further generation until recovery; a completed source stage permits explicit installation retry.

`installProject` invokes `npm install --no-audit --no-fund --install-links` with separate arguments and no shell. A successful exit is insufficient: both npm locks and all recorded installed package manifests must agree with declared state. Local file dependencies are packed with `--install-links`, avoiding source symlink dependencies. `checkProject` runs only named `npm run <script>` argument vectors recorded in realized metadata, after installation evidence passes. Child stdout/stderr are discarded at the engine boundary to exclude secret-bearing script output. An injectable runner supports labeled fake-process acceptance. These checks establish local recorded-dependency manifest consistency, not a cryptographic audit of all installed bytes.

`inspectProject` is read-only and reports damaged installation truthfully even if earlier metadata says completed. Re-add preserves failed/pending installation state and does not silently repair it. `doctorProject` adds local toolchain/config-example checks without probing providers or inspecting private values. No check or install is an implicit consequence of `applyPlan`.

Recovery restores or removes only journaled files whose current bytes match that operation's postimage. Already restored/preimage files are recognized; subsequent edits remain with explicit conflicts. Only explicitly recorded empty source directories may be removed. There is no repository reset, broad cleanup, provider action or rollback of npm scripts, dependency storage or external effects. A remaining conflict blocks new mutations until the operator resolves it and retries recovery. Explicit stale-lock abandonment is allowed only for a recorded same-host PID that is demonstrably absent; a live/unknown owner always blocks.

Filesystem checks and atomic renames protect against stale plans and ordinary concurrent editing. Node filesystem paths do not provide an adversarial cross-directory transaction or eliminate the final operating-system race against a privileged process replacing an ancestor. This is a cooperative local-project operation model; it does not claim an OS sandbox.

## Focused evidence

`test/engine.test.ts` imports the built engine and covers pure previews; source-only init; missing choices, graph cycles/conflicts and invalid schemas/toolchains; stale absence/content guards; unsafe identifiers/traversal/symlinks; scoped managed/package/doc behavior; private saved plans; interruption and conditional recovery; later edits and forged journals; failed/damaged fake installations; separate fake checks; overlapping operation locks/live-owner refusal; explicit release edges and customized-source preservation. Fake npm fixtures are process/metadata contract evidence, not real npm or generated-app acceptance. The coordinator owns the fresh CLI build and independent packed/generated application acceptance; the engine worker executes its own focused suite against that build.

### Local verification, 17 November 2026

Engine source/contracts/test snapshot SHA-256: `af330fe6484dbb50127949bbdb79737238769fa45e55475750e78aef07ec67b3` (relative filenames and bytes in sorted engine-file order; excludes this report and concurrent CLI/recipe changes). Coordinator supplied the fresh CLI build; this worker emitted no `dist` files and installed no dependencies.

- `node --test --test-concurrency=1 test/engine.test.ts`: **23 passed, 0 failed** on Node 26.13.1/Linux. The first 16-case run exposed dropped manual upgrade work; that defect was corrected before the final run.
- `node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.test.json`: passed after the final engine/test changes. Earlier standalone engine `tsc --ignoreConfig --noEmit ... src/contracts.ts src/engine/*.ts` also passed.
- `node_modules/.bin/eslint src/engine test/engine.test.ts`: passed.
- `node_modules/.bin/prettier --check src/engine test/engine.test.ts docs/CLI-ENGINE.md`: passed; final documentation-only evidence was formatted separately.

The 23 cases include simulated npm installation and check outcomes, plus one real npm script subprocess with positive stdout/stderr sentinel controls. They establish engine filesystem/process contracts; they do not establish real dependency installation, generated Nest boot, provider behavior, database integrity or deployment. Those remain coordinator/integration acceptance responsibilities. Exact executable public exports are in `src/engine/index.ts`, and all engine tests import its fresh built output.

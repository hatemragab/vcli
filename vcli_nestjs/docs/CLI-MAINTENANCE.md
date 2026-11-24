# Private release maintenance and HTTP mail extension

Private CLI `0.1.2` adds an upgrade from `0.1.1` for projects whose managed files match their project lock. A recognized `0.1.0` curated predecessor can also upgrade directly. From the built target checkout, preview with `node bin/vcli.mjs --project /path/to/app upgrade --to 0.1.2 --dry-run`. Apply with the same command without `--dry-run`, then run the project's pinned `npm exec -- vcli check`. Commit the updated app source, package lock, VCLI lock and vendored assets together.

For an existing database-backed `0.1.2` app, use the built checkout containing the seeding feature and preview that same command. The plan adds the seed entry points and files to matching managed projects, and preserves the application version and recorded developer-owned scaffolds, including any previously generated seed files and registry. Resolve managed drift or a pre-existing unowned path reported by the plan before applying it. Add seed files manually beside custom features scaffolded before seed support and register them in `src/seed/custom-seeders.ts`. Rebuild the app after the update or after editing seed files. The app's generated README covers configuration and fixture prerequisites.

During upgrade, VCLI updates the original generated `.gitignore` and `CLAUDE.md` if their bytes match the old templates. For customized versions, anchor the app build ignore to `/dist/` and add `@AGENTS.md` to `CLAUDE.md` while preserving local rules. A clone made before the ignore fix may lack the recorded vendored assets. Recover those exact bytes from the original project workspace, upgrade there, and commit them so subsequent clones can bootstrap. App version numbers now belong to the application, including projects whose earlier VCLI lock recorded the initial value.

## Add IDE tasks to an existing project

Use the built generator containing IDE task support to preview `node bin/vcli.mjs --project /path/to/app upgrade --to 0.1.2 --dry-run`. Review the plan, then apply without `--dry-run`. VCLI adds `.vscode/tasks.json` and `.run/vcli-*.run.xml` as developer-owned scaffolds where the paths are absent and have never been generated. It reports a warning when a proposed path already belongs to your project.

If you already have `.vscode/tasks.json`, add the actions you want to its existing `tasks` array. This example adds Dev. Use a distinct label if you already have a task named `VCLI: Dev`.

```json
{
  "label": "VCLI: Dev",
  "type": "process",
  "command": "make",
  "args": ["dev"],
  "options": { "cwd": "${workspaceFolder}" },
  "problemMatcher": []
}
```

Select the task through **Tasks: Run Task** in VS Code. In IntelliJ IDEA, enable the Makefile plugin and choose a shared configuration in the **Run** menu. A colliding IntelliJ configuration can be updated in the IDE to use the root `Makefile` and matching target. The generated README lists the action names and their Make targets.

## Private development config after upgrades

Fresh `init` creates a private `.env.development`. Keep the existing file when upgrading or adding a capability. Review the generated README, start newly required services, and add required settings privately. For an app using Redis auth rate limits, set `REDIS_URL` to a reachable instance and check the updated config with `npm exec -- vcli config check --config-file .env.development`. Each deployment supplies its own Redis URL and auth credentials.

## Historical 0.1.1 evidence

This implements a curated private `0.1.0 -> 0.1.1` exercise. Neither version is a published registry release. Hatem owns private release activation, remediation rollout and any later publication. The coordinator owns root/leaf versions, selected recipe registration/configuration, command wiring and release integration; the packed follow-up below is explicitly delegated local acceptance. This worker supplies the maintenance APIs, finite source migration, HTTP adapter and focused local contracts.

## Public API and command wiring

`src/maintenance/index.ts` exports:

```ts
getSupportCatalog(): SupportCatalog
inspectMaintenance(projectDir: string): Promise<MaintenanceInventory>
reportAdvisories(inventory: MaintenanceInventory): AdvisoryFinding[]
planMaintenanceUpgrade({ projectDir, targetVersion, catalog }): Promise<MaintenancePlan>
summarizeMaintenancePlan(result: MaintenancePlan): MaintenanceSummary
```

The synchronous catalog and advisory functions have no effects. Inventory and planning read local declared state without installation, subprocesses, network, directory creation, journals or locks. All public summaries omit source bodies, secrets and absolute contributor/project paths. Full generation plans remain private review/apply artifacts.

The root upgrade handler passes its actual installed target `RecipeCatalog` (including local distribution assets), requires `targetVersion` to equal the active exact CLI version, and calls `applyGeneration(result.plan, options)`. It may emit `summarizeMaintenancePlan(result)` for the maintenance-specific source/dependency/codemod/manual view. Existing `savePlan`, `readPlan`, `applyPlan`, `installProject`, `checkProject` and `recoverOperation` remain the only mutation/execution lifecycle. Inventory/advisory commands call the first three APIs; no second mutation engine or package-lock renderer exists.

The supported release edge is conditional on the finite `curated-capture-immediate-v1` predecessor profile; version labels alone do not admit a source migration. The support catalog contains only schema1, Node `>=26.13.1 <27`, CLI/recipe/auth `0.1.0` and `0.1.1`, and the exact forward edge. Unknown versions, release gaps, downgrades, desired/realized drift, changed dependencies, selected provider changes and missing/mismatched target assets fail. `latest` and semver compatibility guesses are unsupported. Target assets must include managed `tools/vcli/package.json` and, when auth is selected, managed `tools/vcli-auth-runtime/package.json` at the exact target, with the compatible auth subpaths retained. The coordinator activates actual compiled leaf/distribution assets; changing a reported version alone is insufficient.

The auth exercise retains existing `errors`, `opaque`, `password` and `jwt` subpaths and optional peers. A peer-free additive root `AUTH_RUNTIME_VERSION = '0.1.1'` supports component identity. The initial isolated old/new exercise compiles accepted opaque mechanics and checks capability/hash/purpose/error compatibility plus that additive export. That initial exercise alone did not establish packed acceptance or a crypto security fix; actual packed component consumption is recorded separately below.

## Finite copied-source migration

Engine `planUpgrade` now accepts `sourceMigrations?: string[]`; `GenerationPlan.sourceMigrations` records `{ id, path, expectedHash, resultHash }` only for actual source replacements. The sole supported source ID is `copied.mail-subject-controls-v1`, on `src/modules/mail/render-message.ts`.

The demonstration broadens subject validation from CR/LF/NUL rejection to all C0 controls and DEL. `src/engine/source-migrations.ts` embeds immutable exact old/new function text. The existing pinned TypeScript6.0.3 parser locates exactly one top-level exported `renderMessage` declaration; only a byte-exact recognized function is transformed. Known text inside a comment/string does not qualify. Adjacent custom source is preserved byte-for-byte. TypeScript is a CLI production dependency for this bounded AST recognition; it remains development tooling rather than an application SDK.

A customized/missing/ambiguous function is left untouched. The planner instead creates a scaffold-once `docs/vcli/patches/mail-subject-controls-v1.patch` containing the curated demonstration old/new function diff and records review-required pending work. It includes no developer file contents. This is a review aid, not a general merge or assertion that an unsupported shape is fixed. Applying the exact new shape manually makes it recognizable on later inspection.

Named source replacement is an explicit exception to ordinary scaffold-once ownership. The planner checks the selected path's established scaffold ownership and actual supported function, records a full touched-byte hash, and retains scaffold ownership. Saved-plan validation requires the finite ID, fixed path, matching hashes, recognized new function and recorded migration. Apply rechecks actual old executable shape and the exact transformation under the existing exclusive project lock. Ordinary additions/scaffolds cannot use this exception, adopt source, select arbitrary transforms or replace custom functions.

Realized lock reading accepts only known tool versions `0.1.0` and `0.1.1`; saved plans still require the exact active `TOOL_VERSION` (`0.1.1`). Existing source migrations with the `copied.` namespace must be known IDs. Recipe edges remain explicit curated caller input. The shared apply/staging/journal/recovery logic and separate installation/check outcomes are unchanged.

Changes under selected local `file:` package source directories invalidate installation even when dependency strings stay identical. Local installation inspection also compares the vendored manifest version with the installed lock version. A vendored auth/CLI bump cannot preserve an earlier installed claim. npm owns its own lock update; failed installation remains failed across an idempotent source re-upgrade.

## Inventory and advisory meaning

Inventory is restricted to declared private CLI/auth manifests, managed auth package asset provenance, and the known copied mail function when present. It neither scans arbitrary custom source nor reads private environments. Known auth assets must still match recorded managed hashes; installed auth asset bytes are compared with the corresponding managed package assets before local installation is treated as intact. Customized/unrecognized sensitive source remains unknown.

The finite records `VCLI-FIXTURE-AUTH-PACKAGE-001` and `VCLI-FIXTURE-COPIED-SUBJECT-001` are **demonstration advisory fixtures, not CVEs or real upstream vulnerability reports**. Both demonstrate affected `0.1.0` and target `0.1.1`, with Hatem as remediation owner:

| Component                    | Remediation and evidence                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private auth runtime library | Compatible vendored package update, explicit installation, then affected verification. Source-fixed/install-pending is separate from local installed evidence. |
| Copied mail validation       | Exact named source patch or manual source review. Updating the auth runtime does not fix this copied function.                                                 |
| Customized/unknown source    | Explicit unknown finding and manual review; a version field does not establish remediation.                                                                    |

`fixed` describes the specific recognized source or locally installed curated component. It does not establish check completion, arbitrary custom-code safety, a deployed update or a real-world vulnerability remedy. Deployed remediation remains operator evidence. The plan separately lists source changes, dependency transitions, planned/already-applied codemods and review-required manual work.

## Selected HTTP mail contract

Root registers `mail.http`, options `{ provider: 'resend', reliableActions: boolean }`, and selected config `mail: { from, apiKey, timeoutMs, maxConcurrency }`. Runtime fields are `MAIL_FROM`, secret `RESEND_API_KEY`, `HTTP_MAIL_TIMEOUT_MS` (default10000, bounds50–60000) and `HTTP_MAIL_MAX_CONCURRENCY` (default4, bounds1–16). Reliable delivery additionally uses the existing selected database/keys/policy, with lease longer than the HTTP deadline. No Resend SDK or new application dependency is required.

The selected renderer emits only `modules/mail/http-mail.service.ts` and `http-mail-protocol.ts` with the existing neutral mail/rendering files. `createMailSender` constructs `new HttpMailService(config.mail)`; the existing explicit MailModule providers/exports, trusted fake sender injection, reliable MailIntentService, Firebase behavior and shutdown ownership remain compatible. SMTP/capture source is omitted from HTTP output. Durable consumers continue awaiting unchanged `MailService.submit(MailMessage)`.

The adapter uses one-recipient canonical escaped rendering, a fixed HTTPS `https://api.resend.com/emails` endpoint, JSON POST, bearer authentication and disabled redirects. There is no environment/configurable endpoint or plaintext production bypass. A trusted constructor-injected fetch boundary supports test peers; ordinary factories use native fetch. Secret credentials use ECMAScript private fields and are never part of a returned outcome. Request bodies are capped at128KiB, responses at16KiB, with a total deadline covering response consumption and bounded concurrent submissions. `close()` aborts owned in-flight requests.

The request includes a stable `Idempotency-Key: vcli-mail/<operationId>`. Resend documents a24-hour key window and rejects changed request bodies; this is provider-scoped deduplication, not an unlimited exactly-once promise. The adapter makes one attempt and never automatically retries a timeout/disconnect. A caller must retain the identical message/operation and reconcile uncertain acceptance; generating a new key to escape ambiguity can duplicate mail. [Resend idempotency contract](https://resend.com/docs/dashboard/emails/idempotency-keys).

A bounded valid receipt translates to `accepted` with the original operation reference, never inbox delivery. Documented400/401/403/404/405/422 failures and idempotency-body conflicts are permanent `rejected`;429 is `unavailable` with numeric seconds `Retry-After` converted to milliseconds and capped at24hours. Documented500/503 failures translate to `unavailable`, while concurrent-idempotency conflicts, undocumented upstream statuses, redirects, malformed/oversized receipts and transport/deadline failures remain `unknown`. Neither raw provider errors, response bodies, headers nor action content enter outcomes. [Send Email API](https://resend.com/docs/api-reference/emails/send-email), [error contract](https://resend.com/docs/api-reference/errors), [rate-limit headers](https://resend.com/docs/api-reference/rate-limit).

Those official primary sources were checked through web/Context7 on17November2026. The adapter's conservative unknown outcomes are local policy; no live Resend request was made. Account/domain authorization, sending-key scope, production TLS/provider conformance and inbox/delivery acceptance remain external.

## Initial isolated evidence

Initial worker emission was confined to ignored `var/cli-maintenance/`. It contains isolated engine/maintenance/selected-renderer compilation, selected HTTP runtime files, and peer-free old/new auth fixtures. Test-owned loopback HTTP peers use ephemeral ports and always close connections/listeners in `finally`; no external API, shared service, browser, Docker, installation or shared build is run.

- `node --test --test-concurrency=1 test/maintenance*.test.ts`: **13 passed, 0 failed**. This covers private support edges/auth compatibility, AST positive and comment/string/customized negatives, pure upgrade preview, copied-source patching, bounded package/prose preservation, unknown/manual advisories, target/refusal/drift, stale/forged plans, interrupted source, failed installation and later-edit recovery, managed/installed auth-code drift, real loopback HTTP headers/body/escaping/idempotency,429/5xx/permanent/unknown outcomes, response/body/deadline/concurrency bounds and selected immediate/reliable composition.
- `node --test --test-concurrency=1 var/cli-maintenance/engine-regression.test.ts`: **23 passed, 0 failed**. This is the unchanged existing engine suite with only runtime import URLs redirected to the isolated current-source compilation; no stale/shared `dist` is consumed.
- `node_modules/.bin/tsc --noEmit --pretty false -p tsconfig.test.json`: passed.
- Scoped ESLint for engine, maintenance, selected mail renderer and maintenance tests: passed; scoped Prettier check passed.

The first test typecheck found an invalid `await` inside a non-async assertion callback; it was corrected before runtime execution. All listed final checks passed. Simulated npm manifests/runner outcomes establish lifecycle contracts, not actual dependency installation. Old/new auth and HTTP runtime compilation establish isolated local behavior, not packed app acceptance or provider support. These initial isolated results did not establish packed upgrades. The subsequent worker dispatch owns the packed follow-up below; selected native reliable delivery and live provider/deployed evidence remain separate and Phase09 is not independently closed by these fixtures.

## Packed follow-up and conservative predecessor admission

`scripts/verify-packed-maintenance.ts` exercises actual installed private tarballs outside the checkout, with cache-only `--offline` npm operations, separate source/install/check/build/runtime results, private logs under `var/cli-evidence/maintenance`, and task-only temporary cleanup. It uses real Nest initialization, readiness/provider lookup and awaited capture, then closes the application without opening a listener; no database or external provider is contacted.

The retained historical `var/vcli-cli-0.1.0.tgz` is the **pre-acceptance bootstrap** SHA-256 `c0103c720a3ea20917026fefaee9c4489ee0419101baa40b7a1255be0db672b0` (181KiB compressed,857781 unpacked bytes). It has no auth-runtime distribution assets and is not the later accepted private0.1.0 artifact `6dd4e68ca017fdffc01e1ac3cba2edd6c7582c68a7c4338dfea88cc7e514bdcf`, which is no longer retained. Evidence for one hash never transfers to the other.

Real offline installs of both bootstrap profiles succeed, but their untouched check/build gates fail: provider-free minimal has `TS2322` (`Object.values({})` inferred as `unknown[]` in create-app), while capture has `TS2345`/`TS2367` (the old capture environment type excludes production while bootstrap guards still reference it). These are recorded historical failures, not green baseline evidence. Minimal also has a logging-schema scaffold-to-managed ownership conflict; current maintenance never adopts that developer ownership. Both historical profiles must be refused before source writes, including after normalizing an optional mail choice. There is no historical-auth upgrade claim because that artifact never shipped the package.

For old tool/recipe versions, admission now recognizes exactly `curated-capture-immediate-v1`: only foundation + immediate capture with explicit normalized options and eight fixed source/API fingerprints, including managed provenance for composition/configured capabilities/mail module/log schema, and exact declared mail service/capture/submitter contracts. An unknown old capability profile is refused independently of the bootstrap artifact hash. No custom application module, private environment or arbitrary user-file inventory is used. The copied `renderMessage` function is deliberately excluded from this compatibility fingerprint so its exact supported codemod or explicit manual fallback remains a separate outcome. A recognized contract's hashes become saved-plan guards, so intervening scaffold edits are preserved and block apply.

The positive release-edge fixture is explicitly a **synthetic curated predecessor**, constructed from actual packed current distribution/runtime contracts with old private version metadata and the finite old copied function. It is not a recovered historical0.1.0 release. The separate auth0.1.0 package fixture is likewise synthetic: accepted opaque/error mechanics without the additive1.1 version export. Both predecessors are npm-packed/copied and consumed through real offline installation; the retained historical archive is never rewritten. Final packed results and artifact hashes are recorded below after execution.

Real packed execution additionally exposed npm's local-folder cache behavior: an unchanged `file:tools/vcli` spec retained installed0.1.0 after vendored source became1.1, despite npm exiting0. The engine correctly refused to call that installed. Its explicit install now supplies named arguments for only selected managed local file dependencies, validates those source paths/ancestors and manifests before running npm, and rechecks managed package fields afterward. npm alone rewrites its own lock; unrelated scripts/dependencies remain developer-owned. This avoids both a false success and broad cache/dependency deletion. The separate component consumer uses the same deliberate named local-spec re-resolution. A focused contract also denies a successful-looking npm run that changes a selected managed manifest field.

The packed gate also confirmed that npm's named install form skips root project lifecycle hooks. Selected local re-resolution is therefore followed by the ordinary project install, with managed manifest validation after each child; when local dependencies are already complete/healthy, only the ordinary install runs. This preserves the developer's root installation hooks while keeping the lock throughout, and a real failing preinstall remains a failed installation. The scoped noEmit check excludes unrelated concurrent owner tests; a broad test-config check observed an external diagnostic-services assertion-message typing error, reported to the coordinator without editing that owner's files.

Same-version private artifact payloads are now part of local installation evidence. For managed local packages, inspection compares the recorded source provenance and installed payload bytes, excluding npm-normalized package JSON while still checking its version/declarations. It examines only declared managed vendored package files, not arbitrary developer source. Standalone copied auth consumers additionally compare their literal declared export entrypoints. A byte change cannot remain locally installed/healthy solely because both manifests still say1.1; the packed harness includes real same-version CLI and auth payload edits, explicit re-resolution and byte-equality assertions. Unknown/custom source remains outside advisory certification.

The exact prior CLI false-negative was traced to an existing ownership bug: marker **string literals** inside managed JS/declarations were being interpreted as documentation regions. Source/installed bytes matched, but the ledger stored a region-only hash. Planning now permits regions only for root `README.md` and `AGENTS.md`; vendor/code/template bytes always have full ownership. Lock and saved-plan validation reject legacy/forged non-document region metadata before effects, with no blanket adoption. Tests cover marker literals, full-source conflicts, vendor Markdown and preserved root prose. Old private fixtures require fresh generation or an explicit reviewed migration; full installed-byte checks remain strict.

A real copied auth probe showed npm also retains same-version local payloads even with explicit named specs and `--force`. The engine does not accept that result. When an existing **selected managed local package** is stale, npm is asked to remove precisely that derived package with `--no-save --package-lock=false --ignore-scripts --offline`, retaining declarations and the main npm lock, before named local resolution and the ordinary install. npm owns all dependency-tree/lock changes; no source or cache tree is deleted directly. Healthy/unrelated local packages are excluded. The actual auth probe then copied fresh bytes, and the final packed gate verifies this behavior for CLI and auth. This is an explicit repairable installation phase, not a filesystem/provider transaction or rollback guarantee.

### Prior packed run before the last manifest guard, 17 November 2026

`VCLI_MAINTENANCE_REUSE_HISTORY=1 node scripts/verify-packed-maintenance.ts` completed successfully at **2026-11-17T06:46:03Z**. The final ledger contains45 assertion/command stages, including8 intentional nonzero outcomes: four immutable historical check/build failures, three historical refusal controls reused from the exact recorded archive, and one real controlled npm installation failure. These negative outcomes are not reported as successful historical builds or successful installs. Original failed attempts and the historical observation ledger remain separately retained.

| Artifact                      | SHA-256 / result                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual target private CLI1.1  | `6b76bcaa584ebc0896f8e4ecbcd8c6955821b30b2b9193a94d4fa4b6fc7cf80b`,438146bytes; npm packed with scripts disabled, separately installed offline outside checkout.                               |
| Synthetic curated auth0.1.0   | `44d4f80ca3a667523968224520b584553a03f1971287f33c17bbc6e433320fa4`; real packed/copied consumption, explicitly not historical release evidence.                                                |
| Actual target auth1.1         | `105283db11367594d1f5741b3d17a3855dc31df72d1fcbc36472354642e8428a`; packed and installed with optional JOSE/Argon peers absent for opaque/error/root API use.                                  |
| Retained historical bootstrap | `c0103c720a3ea20917026fefaee9c4489ee0419101baa40b7a1255be0db672b0`; offline installs completed, check/build failures and pre-write refusal retained; no auth assets or historical-green claim. |

The recognized synthetic curated predecessor passed real declared checks, Nest build and application initialization/capture. Preview and saved-plan guards preserved private/custom bytes; an intervening contract edit was refused. Source migration, explicit installation, target checks/build/application tests and awaited capture/runtime close then passed independently. Custom integration, private environment, custom script, unrelated direct cached `ms` dependency and unmarked prose were preserved. Re-upgrade produced no source changes.

Real same-version1.1 CLI and copied auth payload changes were diagnosed as stale before installation. The bounded npm-owned repair copied fresh bytes exactly and restored local installation evidence; CLI checks passed afterward. The deliberately customized sensitive function remained untouched, received the curated manual patch, and retained an unknown advisory finding. A real project preinstall exiting23 produced CLI `INSTALL_FAILED`, remained failed after a source no-op, and recovered only after explicit corrected installation and checks. A stale create preserved the arriving file; interrupted source recovery reported a conflict and preserved post-write developer bytes.

The same current source also passed14 focused maintenance/ownership cases, the unchanged23 engine safety cases, scoped noEmit, scoped ESLint and scoped Prettier. Two broad test-config checks saw an unrelated concurrent diagnostic-services assertion-message typing error; it was reported rather than edited or claimed passed. No historical failed build was repeated in the final run, no download occurred (all npm operations offline), no shared build was emitted by this worker, and no database/provider call or listener was started. Application runtime evidence is Nest initialization/provider lookup/readiness/capture/close, not HTTP binding or external delivery. Task-owned temporary workspaces were removed; private evidence is retained at `var/cli-evidence/maintenance/results.json` and the neighboring hash-named archives/logs with directory mode0700 and file mode0600.

These results establish the finite recognized private predecessor and component upgrade contracts. They do not admit arbitrary0.1.0/1.1 snapshots, legacy invalid region provenance, other capability predecessors, live-provider delivery or deployed remediation.

A final bounded preflight now checks each selected managed local source `package.json` against its recorded full hash and the declared package name **before** changing pending state or invoking npm. Installed package JSON remains exempt from raw byte equality because npm may normalize it. An edited source name/dependencies/scripts cannot reach any npm lifecycle action. The negative regression asserts zero runner calls and unchanged realized state, including a matching-hash/wrong-declared-name case; unrelated custom local dependencies remain outside this guard. The packed harness also bootstraps vendored CLI dependencies using the actual Make-style prefix install and asserts that the source manifest hash remains unchanged before calling the vendored CLI installer.

### Final artifact with source-manifest guard and bootstrap

The final `VCLI_MAINTENANCE_REUSE_HISTORY=1 node scripts/verify-packed-maintenance.ts` run completed at **2026-11-17T07:01:07.717Z**: **46 stages completed**, including8 expected negative command outcomes retained as historical failures/refusals or the controlled installation failure. It used final private CLI1.1 SHA-256 `4b0d6f0263ae500dc3be2d740f0e6559583f6294cc8a1c594ebd792eb7c3f326` (438482bytes). The prior45-stage artifact remains separately recorded; results do not transfer between hashes.

The additional actual Make-style bootstrap prefix install passed offline, left the source manifest hash unchanged, and that vendored CLI successfully installed the predecessor project. The same final artifact then passed source migration, target installation, checks, build, generated tests, Nest/capture initialization and close, actual same-version CLI/auth stale-byte rejection and npm-owned repair, manual-custom-function handling, real failing preinstall and repair, stale-plan denial and interrupted recovery preserving later edits. Source, installation and checks remain independently recorded. The final test-owned workspace was removed, and `var/cli-evidence/maintenance/results.json` is the authoritative private ledger.

After the last source guard,13 focused maintenance cases passed, including zero npm calls/unchanged state for an edited selected managed source manifest and declared-name mismatch; the2 ownership regressions and23 unchanged engine regressions also passed in scoped runs. Current scoped noEmit, ESLint and Prettier passed. The final artifact is private local evidence for the finite recognized predecessor/component contracts; no historical-green, public-release, arbitrary-baseline, provider-delivery or deployed-remediation claim is added.

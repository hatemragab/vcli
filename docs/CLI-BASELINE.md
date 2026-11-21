# Accepted implementation baseline

Recorded 17 November 2026 for the authorized private CLI implementation. The owner approved full source implementation, public-library reuse, simple flat NestJS modules, inherited native repositories, one database chosen at init and enforced acyclic dependencies. This record resolves Phase00 setup choices; later feature/platform acceptance remains separate.

## Exact tested toolchain

| Area             | Pinned baseline                                            | Evidence                                                                                                                                            |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contributor host | Linux x64, Node26.13.1, npm11.20.0, ESM                    | Executables inspected; independent installed reference builds/runtime passed. No Mac/Windows/WSL support claim.                                     |
| Compiler/tests   | TypeScript6.0.3, native Node test runner                   | Strict source/tests noEmit, ordinary emitted ESM and real child-process tests.                                                                      |
| CLI              | Commander15.0.0, Inquirer8.7.5, Zod4.6.7, Prettier3.10.1   | Exact dependencies/lock installed; Commander primary versioned documentation consulted; CLI command tests and private tarball executable exercised. |
| Generated HTTP   | Nest12.4.2, Express5.3.0, Zod4.6.7, Pino10.4.0             | Existing native references passed static/build/HTTP/browser; generated-output gates recorded separately.                                            |
| MongoDB          | Mongoose9.12.0; local acceptance MongoDB8.0.38 replica set | Native constraints/transactions/indexes and protocol acceptance in its own reference.                                                               |
| PostgreSQL       | Drizzle0.45.4, pg8.23.1; local acceptance PostgreSQL16.16  | Native SQL constraints/transactions/codecs and protocol acceptance in its own reference.                                                            |
| Local crypto     | JOSE6.2.16, Argon20.45.2; private auth-runtime0.1.0        | Versioned subpaths; generated wrappers/host-pressure acceptance still separate.                                                                     |

Installed upstream package manifests were inspected: Nest core requires Node>=20; Commander15 requires Node>=22.12; npm11 requires ^20.17 or >=22.9; the selected Node26 tuple satisfies those declared ranges. These are reproducible tested pins, not claims that every pin is the latest. The implementation uses npm instead of the earlier illustrative pnpm recommendation. Later libraries/platform APIs are verified when their feature begins.

## Distribution, provenance and ownership

The CLI and narrow auth runtime use private local identities `@vcli/cli` and `@vcli/auth-runtime`, version0.1.0. No registry namespace is claimed or contacted for publication. No public license was selected; see [the notice](../LICENSE-NOTICE.md). Hatem owns release/publication decisions; implementation contributors provide patch/test evidence. Public distribution stays disabled until namespace/license policy is selected. This does not block owner-controlled local evaluation.

Generated projects pin a bundled private CLI through `file:tools/vcli`; the tool is copied from the actual installed distribution, not an absolute checkout path or source symlink. Its assets include all generator recipes as development tooling; application source and production SDK closure contain only selected capabilities. Sensitive auth mechanics have one optional-peer runtime package, while account policy/native atomic persistence stay visible in application source. Copied sensitive source uses an explicit source/manual patch path; package updates alone do not patch deployed applications.

Implementation is newly written for this repository from the accepted plan and owner-reviewed reference code. No SuperUp/Whizpee private implementation, branding, credentials, environment files or chat data is extracted. Public dependencies retain their own licenses.

## Canonical example and generator behavior

The approved functional example is authenticated owned notes: POST `/api/notes` accepts a trimmed 1–120-character title and optional body up to10000 characters. The verified principal supplies ownerId; the server supplies UUIDv4/time. GET owned list is bounded1–100 (default20), stably ordered; missing/foreign IDs map to the same404. Notes persist before an advisory realtime hint; hints do not imply durable recipient delivery or HTTP idempotency. The hand-built examples implement this contract; generated functional-example acceptance remains required. A name-only generator emits typed unexposed scaffolds and manual consumer/migration steps rather than inventing public CRUD.

Default layout is flat feature entity/service/module plus controllers/DTOs/helpers only when useful. One class per file, strict TypeScript, kebab-case files and single quotes apply. Controllers validate transport input and trusted identity; service methods may use native inherited repository helpers internally. External effects stay outside retryable transactions. File/type/feature graphs are checked; forwardRef, locators/global modules and hidden loading cannot hide cycles.

Foundation requires no DB/auth/provider. Desired schema1 `vcli.json` records project name/npm and family-keyed recipe/options; schema1 `vcli.lock.json` records realized choices/ownership and separate source/install/check state. Managed registration/config/package fields and bounded guidance blocks can update; developer source/custom composition/private env survive. Capture is bounded private development/test inspection, never production mail or an HTTP debug route. Preview is zero-write; explicit saved plans are private writes. Add/recovery rechecks touched preconditions and preserves subsequent edits. See [engine contracts](CLI-ENGINE.md), [recipe contracts](CLI-RECIPES.md) and [implementation scope](CLI-IMPLEMENTATION-CONTRACT.md).

## Security/setup decisions and deadlines

| Decision                   | Recorded value or next gate                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credential transport       | Native bearer/API-token profile; cookie/CSRF selection is separately unimplemented unless accepted.                                                                                                                                                                                           |
| Password policy            | App input12–128 UTF16 code units and <=256UTF8 bytes, preserved Unicode/no truncation. Reviewed Argon2id19456KiB/time2/parallel1, max2 concurrent jobs; library has validated bounded policy. Host pressure/health and changed-policy evidence required in Phase03.                           |
| Session policy             | Short local JWT access plus current durable authority; hashed opaque rotating refresh/actions, strict single use and reauthentication after ambiguity. Defaults access300s/session86400s/recent-auth300s; key/credential rotation and compromise tests are required, not implied by defaults. |
| Firebase enrollment        | Client creates >=256-bit opaque capability once per intended session and reuses on retry; backend hash+subject/generation yields one stable enrollment. Fresh auth_time+atomic cutoff required for a new capability; revoked capability cannot reactivate. No second Firebase API JWT pair.   |
| Identity/install lifecycle | No email-only merging. Explicit ownership-proven linking/rebind/deletion/cleanup retention policy is finalized before Phase03 lifecycle routes; no unrelated product cascades.                                                                                                                |
| Object storage             | AWS plus named R2 profile; each mode needs declared conditional/checksum/version/transfer guarantees. Arbitrary compatible endpoints are not certified. Missing mode support fails before mutation. Live conformance is externally pending.                                                   |
| Diagnostics                | Bounded same-user local application JSONL/reader/MCP first; defaults1MiB×3, with validated caps. Worker/DB/infrastructure, remote credentials and stronger isolation require Phase07 code/evidence; same-user is never a sandbox claim.                                                       |
| Platforms                  | Dokploy/Coolify target-native Compose artifacts; CapRover explicit preprovisioned dependencies and captain/Dockerfile flow. Operator API versions/auth/native state/release contracts are verified in Phase08. No automatic Compose parity or cloud provisioning.                             |
| Test resources             | Isolated capped cached Mongo/Postgres available on contributor private network; no provider credentials, deployment hosts or reachable physical devices supplied. External sign-in/cloud/push/inbox/deployed evidence remains pending.                                                        |

The [full requirement/phase review](CLI-PHASE-REVIEW.md) maps REQ01–22, required versus optional variants, dependencies and nonoverlapping worker ownership. Every required provider family remains in scope. Missing external resources do not become fake passes or block independent source work. Public publication/provisioning/production migration/deployment still require separate authorization.

## Phase00 review evidence

| Acceptance  | Result and evidence                                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P00-A01/A02 | Reviewed standalone instructions, full product register and every phase with an independent Orca audit; no private project is a prerequisite and all22 requirements have phase paths.                                 |
| P00-A03     | Exact installed toolchain/engines/locks and primary Commander API inspected; native reference tuple tested. Later provider/API verification deadlines remain explicit.                                                |
| P00-A04     | Canonical owned example and customization-safe capture/module seam specified; real engine23 tests and CLI8 command tests support lifecycle mechanics, while generated runtime acceptance stays separately open.       |
| P00-A05     | Three target-native artifact/runbook feasibility profiles reviewed; unsupported cluster/local-volume assumptions and preprovisioned CapRover dependencies are explicit. This is artifact feasibility, not deployment. |
| P00-A06/A07 | Private distribution/provenance/patch ownership, available resources/security gates and finite later decisions recorded here; Phase01 can proceed without a new owner approval request.                               |

The CLI first-release build is in progress and uncommitted. Phase00 review does not complete Phase01–09, certify external services or convert historical reference results into generator evidence. Actual generated install/build/boot/custom-add results belong in their phase acceptance records.

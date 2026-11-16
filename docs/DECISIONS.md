# VCLI decision register

Revision 0.2, 16 November 2026. These are the recommended implementation baseline synthesized from the discussion and independent reviews. Preparing this document does not record owner approval of every recommendation and does not authorize implementation. Phase 00 records accepted choices and deviations before dependent work.

## Baseline recommendations

| ID | Recommendation | Reason and limit |
| --- | --- | --- |
| D01 | Standalone TypeScript CLI; normal Nest build/start. | Own project planning without replacing a compiler or using private Nest internals. No initial Schematics dependency. |
| D02 | Curated recipe registry and dependency DAG. | Resolve supported choices deterministically. A registry import for a new provider is acceptable; no marketplace or general solver. |
| D03 | Tool-owned generated registration/config files; developer-owned scaffolds. | Ordinary `add` does not rewrite arbitrary customized TypeScript. Hash/precondition checks protect touched files, not freeze the whole app. |
| D04 | `vcli.json` desired choices; `vcli.lock.json` realized recipe and ownership metadata. | Refuse generation-relevant drift. The lock is not a duplicate package-manager lock or a claim of provider readiness. |
| D05 | One narrow authentication runtime package when Phase 03 needs it. | Centralize reviewed protocol mechanics and patch distribution; generate application policy, persistence mapping, and composition. No large runtime framework. |
| D06 | Mongoose for MongoDB; Drizzle + pg with reviewed SQL migrations for PostgreSQL. | One supported implementation per database initially. Keep driver types inside adapters. Exact versions require Phase 00 verification. |
| D07 | Explicit transaction coordination and opaque context. | Conditional writes where sufficient, real transactions where required. ALS is not mandatory and does not establish atomicity. |
| D08 | UUIDv4 public identifiers from standard platform cryptography. | Same wire format without timestamp/synchronization assumptions. Generate outside pure domain code. Cursor ordering uses explicit stable sort fields. |
| D09 | Zod-based validation for the new blueprint through a compatible official Nest integration. | Reuse schema tooling without unnecessary bridge packages. Verify exact Nest/OpenAPI/WS support before pinning. Preserve strict input and safe errors. |
| D10 | Firebase ID tokens plus independently revocable opaque app sessions. | Do not issue a second API JWT pair by default. New enrollment requires recent auth and a revocation cutoff with an atomic authority boundary. |
| D11 | Local short-lived JWT access, opaque hashed rotating refresh, independent device sessions. | Validate issuer/audience/algorithm/key/expiry; atomic single-use rotation. Initial strict policy requires reauthentication after unrecoverable ambiguous refresh. Transparent recovery is deferred. |
| D12 | Socket.IO first, then Centrifugo and native WebSocket. | Prove an in-process addition before separate-service integration. All three remain required, with transport-specific guarantees. |
| D13 | Transport-neutral mail rendering and action-email workflow. | SMTP, capture, and later HTTP adapters share callers. Firebase-managed action mail is not a general SMTP provider. |
| D14 | Purpose-routed push destinations. | FCM ordinary push and APNs VoIP may coexist for one installation under explicit routing. Session, installation, connection, and token are different records/concepts. |
| D15 | Small storage capabilities with verified provider profiles. | Unique attempts plus enforced immutability/version binding; safe promotion remains an alternate strategy. No universal S3 compatibility claim. |
| D16 | Thin dev/service commands over Nest and supported service tooling. | No custom daemon, file watcher, global process manager, or restart supervisor. |
| D17 | Deployment artifact renderer separate from authenticated operator. | All targets get explicit profiles/artifacts; Dokploy operator first, then other required operator support. No generic Compose parity. |
| D18 | Structured app logs early; Vector/Logdy/retained evidence/MCP expanded in Phase 07. | Collection, viewing, querying, and assertions are separate. Local same-user MCP is not automatically a sandbox. |
| D19 | Dependency updates, managed regeneration, specific codemods/manual patches. | No general three-way merge engine. Security maintenance starts with each feature; Phase 09 proves and expands upgrades. |
| D20 | Small first milestone; all auth/database combinations tested early. | Minimal init and safe add first, Firebase/Mongo reference, then PostgreSQL/local auth before expanding the catalog. |
| D21 | One handwritten class per file and owner-based application structure. | Preserve the user's conventions; related pure types/helpers can share. Generate only active layers. |
| D22 | Start with one package manager and coordinated toolkit releases. | pnpm is the recommended contributor baseline. Additional package managers/host profiles require explicit support tests, not guessed compatibility. |

## Decisions still requiring selection or measured values

These are finite setup/policy decisions, not permission to redesign the product or leave dependent work half-configured. Record owner input or a justified implementation choice within authorized scope.

| ID | Choice to record | Needed by | Recommended handling |
| --- | --- | --- | --- |
| O01 | Exact Node, Nest, TypeScript, validator, ORM, SDK, package manager, and test-runner versions; ESM/CommonJS. | Phase 00/01 | Pin one tested compatible baseline. Do not copy old project pins or use `latest` in reproducible fixtures. |
| O02 | Package namespace, distribution visibility, source/template license, maintenance owner. | Phase 00; publication later | Private/local distribution first until owner selects public policy and provenance is reviewed. No publication implied. |
| O03 | Initial supported OS/architecture combinations. | Phase 00/01 | Verify current Linux contributor host; add macOS support tests as available. Explicitly mark Windows/WSL until tested. |
| O04 | Local-auth token durations, password limits/work factors, account verification policy, rate limits, transport mode. | Phase 03 | Measured bounded hashing; native bearer profile first. Browser cookie profile needs separate CSRF/Origin/cookie acceptance if selected. No unexplained numerical defaults. |
| O05 | Firebase provider-status freshness policy and realtime revocation bounds. | Phase 03/04 | Strict verification first. Cache optimization must declare maximum staleness, sensitive-action behavior, and provider-outage behavior. |
| O06 | User bootstrap/linking and account-delete retention policy. | Phase 03 | Explicit idempotent first-use policy; do not merge accounts solely by email. No product-specific retention assumptions. |
| O07 | First named S3-compatible provider and required integrity/transfer modes. | Phase 00 feasibility / 06 | AWS plus one verified compatible preset; R2 is a candidate, not already accepted. Unsupported modes fail early. |
| O08 | Deploy target versions, topology profiles, authorized test accounts/hosts and production secret source. | Phase 00 feasibility / 08 | Dokploy first operator; artifacts and native-compatible profiles for all targets. Paid provisioning is separate. |
| O09 | Diagnostic retention budgets and local/remote MCP transport permissions. | Phase 01 baseline / 07 | Bounded local evidence reader first. A remote backend needs scoped read credentials and declared egress. |
| O10 | API prefix/response envelope/errors, canonical feature inputs and ownership. | Phase 00/01 | Explicit sample contract; exceptions for streams/downloads/health/webhooks. No invented public CRUD. |
| O11 | Native client/device acceptance resources for sign-in and push. | Phase 03/05 | Record available platforms and credentials; backend mocks cannot satisfy native acceptance. |

## Deferred options

Public plugin execution, plugin marketplace, arbitrary existing-project adoption, automatic database/provider migration, generalized source merging, runtime package ejection, extra ORMs, full frontend application generation, custom supervision, mutating MCP tools, and transparent refresh-response recovery are deferred unless explicitly added to scope. Their absence does not remove the requested provider families.

## Resolution record template

```text
Decision ID:
Selected value and rationale:
Status: proposed | accepted | superseded
Authority/date:
Affected phases and contracts:
Evidence/version constraints:
Migration consequences:
```

Replace superseded choices in active documents and keep a short history here. Do not accumulate conflicting rules. An approved implementation request may authorize routine selections; do not invent a separate approval ceremony for every dependency or task.

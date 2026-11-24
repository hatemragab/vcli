# Phase 07 — Diagnostics and AI evidence

**Status: implementation in progress; named acceptance gates remain open.** These are requirements; no collector, viewer, MCP integration, permission boundary, or E2E result is established by this phase document.

Read [START-HERE](../../START-HERE.md), [phase status](../STATUS.md), [product scope](../../docs/PRODUCT.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Follow [TASKS.md](TASKS.md) and [ACCEPTANCE.md](ACCEPTANCE.md).

## Outcome and prerequisites

Developers and authorized agents can explain failures using bounded, correlated evidence from the selected Nest API, workers, database, and infrastructure. They distinguish assertions from log messages and detect incomplete collection. Vector supplies collection/transformation; Logdy supplies live viewing; retained evidence and its reader supply historical queries. These roles compose rather than compete for one provider selection.

Earlier phases establish structured logging, correlation, configuration, the test harness, and safe generation. This phase extends those foundations. It does not postpone basic logging or container feasibility until deployment. Selected database/realtime recipes declare diagnostic sources. Reverify package versions and documented provider behavior against the phase-00 baseline before implementing adapters.

## Scope and topology

The local reference profile uses one shared structured application logger, which validates/allowlists events before writing bounded, rotated JSONL. Vector reads those sanitized files, normalizes/revalidates them and forwards a supported live feed to Logdy. A small reader queries the retained application files directly, so local history and offline MCP queries remain available while collector/viewer services are stopped. Logdy's live buffer is not the historical query database. The hand-built examples implement this application-only topology; they are separate from generator phase completion.

Selected worker/database/infrastructure sources must declare their own parse/redaction, bounded retention, permissions and coverage. They do not become covered merely because the application Vector profile exists, and raw statements/parameters are not implicitly enabled. A read-only MCP facade queries selected retained evidence and, when implemented, test results. Verify the feed adapter rather than inferring support from an ingestion endpoint.

Collector/viewer failures remain bounded and do not prevent business operations. VCLI builds neither a general log database nor a custom supervisor. Development wrappers delegate watching/startup to Nest/package scripts and Compose or selected native service commands. They track task-owned processes, forward signals, preserve state, and report conflicts with independently started services.

A production profile may select a retained query backend. Remote queries require explicit network destinations and scoped read credentials. Offline local readers need neither production credentials nor arbitrary network access. A blanket no-network claim cannot also promise remote queries. Production retention, transport, access control, and ownership require decisions before that profile is advertised.

## Contracts and trust boundaries

Use a versioned event shape containing bounded service/environment/release identity, UTC time, severity, event name, route template, stable error code, request/trace identifier, operation/job identifier, and test-run identifier where available. Preserve infrastructure source and parse status. Propagate approved context through asynchronous work; nearby timestamps alone do not prove database causality.

`DiagnosticReader` accepts structured filters and returns bounded events, an opaque cursor, covered source/time ranges, ingestion delay, drops/gaps, truncation, and unavailable-source information. It accepts no arbitrary filesystem paths, SQL, shell fragments, container IDs, or executable expressions. Cursors preserve project/environment/query scope and report rotated or expired evidence explicitly.

The proposed MCP surface is `project.describe`, `capabilities.list`, `diagnostics.status`, `logs.search`, `operations.timeline`, and `tests.getResult`. These are contract names, not existing endpoints. Authorize every request and referenced run, operation, and cursor. A caller-supplied project label is not authority. Test execution, generation, and deployment mutation remain outside this read-only surface.

A separate process running as the same user is not a sandbox. A local same-user profile states its trust boundary honestly. An isolated/shared-production profile needs enforced filesystem, identity, credential, and network restrictions with negative tests. The reader receives designated sanitized evidence and necessary read credentials, never deployment credentials, raw environment files, or Docker control.

Collector privileges are separate from reader/viewer privileges. A read-only Docker socket mount does not restrict Docker API methods. Socket-proxy endpoint flags alone do not authorize individual projects' containers. Enforce resource scope or document an explicitly reviewed trusted collector boundary; never expose arbitrary cross-project inspect/log access through MCP. Bind Logdy/diagnostic endpoints privately or to loopback by default. Authenticate and authorize selected remote routes.

Logs and test output are untrusted data. Generated guidance treats embedded commands as evidence text. Permission boundaries enforce measurable restrictions; no wording guarantees agent compliance or eliminates all disclosure risk.

## Configuration and generated output

The schema declares sources, project/environment scope, event limits, buffering, rotation/retention, query windows/result bounds, viewer binding, reader transport, and optional backend references. Private values stay outside committed examples. Do not indiscriminately enable database statement/parameter capture. Allowlist at emission and redact again at collection/query boundaries where required. Ordinary evidence excludes credentials, headers, cookies, bodies, signed URLs, private documents, and raw provider responses.

Proposed application output includes `ops/diagnostics/vector.yaml`, a Logdy feed/service profile, sanitized environment examples, logger/correlation wiring, and a diagnostics guide. CLI implementation owns the JSONL reader, MCP facade, filter/cursor validation, and capture orchestration. Generated agent instructions describe tools and evidence limits. Exact paths become supported output only after generation/conflict tests. Unselected profiles generate no empty infrastructure.

Each E2E result identifies source revision, realized nonsecret capability configuration, isolated run, assertions, artifacts, service versions, and collection coverage. Flush diagnostics within a separate bounded deadline after the application outcome. Retention policies also govern potentially sensitive test artifacts.

## Failures, decisions, and risks

Define stable errors for invalid filters/cursors, scope denial, expired evidence, unavailable sources/backend, and unsupported profiles. Return partial coverage explicitly: empty search results do not prove an event never happened. Logging failures must not retry business commands or allocate unbounded queues. Distinguish provider acceptance, recipient observation, persisted state, and assertions from a message saying “sent.”

Resolve retention defaults, logger choice, Logdy feed mechanism, MCP transport, isolated-profile enforcement, remote backend, and collector access in the shared decision register. Principal risks are cross-project disclosure, credential inheritance, misleading completeness, disk growth, observer-induced failures, and correlation mistaken for causality. Acceptance requires failure injection and denied operations before stronger permission or delivery claims.

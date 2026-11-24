# VCLI — Requirements and Architecture Proposal

**Status:** Draft for software engineering review.

**Owner:** Hatem.

**Revision:** 0.1 — 14 November 2026.

**Purpose:** Define a reusable NestJS development toolkit, its extension contracts, generated application architecture, operational workflows, and acceptance criteria.

**Implementation status:** This document proposes future work. No VCLI implementation, published package, provider integration, or deployment is established by this proposal.

## 1. Purpose and review instructions

VCLI should help developers create, extend, test, understand, operate, and deploy NestJS projects using Hatem's coding conventions. It should generate ordinary readable source code, remember project choices, and give human developers and AI coding agents a consistent way to continue development.

**The central requirement is extensibility.** Replaceable technologies and policies must have explicit boundaries. Adding a provider should normally mean implementing an adapter, registering a capability recipe, declaring configuration and compatibility, and passing contract tests. Existing business use cases should continue to depend on the same capabilities.

VCLI must support both initial project creation and safe additions after a project has been customized. It must account for the selected application's supporting services, environment settings, documentation, deployment configuration, and diagnostic evidence.

This document is self-contained. An engineer should be able to review it without reading the original conversation or accessing Hatem's private machine instructions. Source pointers in section 3 provide optional extraction evidence; they are not prerequisites for understanding the requirements.

### 1.1 Meaning of labels

| Label | Meaning |
| --- | --- |
| **Requirement** | Explicit requested scope or coding preference. Reviewers can propose changes, but implementation must not silently omit it. |
| **Recommended** | Proposed engineering solution awaiting review. It is not an already approved implementation choice. |
| **Open decision** | A choice requiring selection before the affected implementation is finalized. |
| **Existing evidence** | Behavior or structure observed in a source checkout or official documentation. It does not prove a new VCLI integration works. |
| **Acceptance criterion** | Observable behavior required to claim a capability supported. These checks have not been run for VCLI. |

“Must” defines a requirement of this proposed design. It does not authorize implementation, account provisioning, publication, production changes, or deployment. The current deliverable is documentation for review.

All command syntax, JSON schemas, interfaces, filenames for generated projects, and package layouts below are illustrative unless identified as existing evidence. Detailed mechanics can change through review while preserving the requested outcome.

### 1.2 Requested reviewer output

For each concern, cite a requirement, decision, or section; explain the failure scenario; propose a correction; and identify its compatibility, effort, and testing implications. Use the review template in section 25.

Review technical correctness, simplicity, extensibility, security, maintainability, operational behavior, and lifecycle cost. Agreement between earlier proposals is not evidence that a design is correct.

### 1.3 Reading map

- Product scope and existing foundations: sections 2–3.
- Coding architecture and extension model: sections 4–6.
- Configuration, commands, and safe generation: sections 7–9.
- Application capability contracts: sections 10–16.
- Environments, deployment, diagnostics, and AI support: sections 17–20.
- Verification, maintenance, delivery, and decisions: sections 21–26.

## 2. Product requirements and scope

### 2.1 Requirement register

| ID | Requirement | Main sections |
| --- | --- | --- |
| REQ-01 | Create a complete NestJS project using Hatem's coding style and architecture. | 4, 10 |
| REQ-02 | Add capabilities to an existing VCLI-generated project without losing custom work. | 8–9 |
| REQ-03 | Generate features, commands, queries, controllers, services, DTOs, repositories, and realtime components in the selected structure. | 8 |
| REQ-04 | Store project selections in workspace JSON and use them for subsequent generation. | 7 |
| REQ-05 | Support Firebase identity and independently selectable local email/password authentication with application-issued JWT access credentials. | 12 |
| REQ-06 | Support selectable Firebase email/password, phone, Google, and Apple sign-in. | 12 |
| REQ-07 | Support application accounts, multi-device sessions, installations, revocation, and notification destination ownership. | 12, 14 |
| REQ-08 | Support MongoDB and PostgreSQL with equivalent application contracts where promised. | 11 |
| REQ-09 | Support Centrifugo, Socket.IO, and native WebSocket as selectable realtime implementations. | 15 |
| REQ-10 | Generate Centrifugo service configuration and backend integration, including its selected supporting infrastructure. | 15, 17 |
| REQ-11 | Support SMTP application email and Firebase-managed or custom-delivered authentication email. | 13 |
| REQ-12 | Support FCM and APNs capabilities, with ordinary push and VoIP behavior explicitly distinguished. | 14 |
| REQ-13 | Support local filesystem storage, AWS S3, and verified S3-compatible providers behind abstractions. | 16 |
| REQ-14 | Generate development and production environment configuration and validate required settings. | 17 |
| REQ-15 | Support deployment to Dokploy, Coolify, and CapRover, accounting for selected services and state. | 18 |
| REQ-16 | Collect relevant NestJS, worker, database, and selected infrastructure logs with Vector integration and Logdy viewing. | 19 |
| REQ-17 | Give AI agents scoped MCP access to diagnostic context and test evidence. | 19–20 |
| REQ-18 | Generate README and agent instructions that explain the selected project and how to extend it. | 20 |
| REQ-19 | Produce testable, maintainable code with explicit checks and honest verification results. | 21 |
| REQ-20 | Make provider families, generation recipes, deployment targets, and diagnostics implementations extendable through stable contracts. | 5–6 |
| REQ-21 | Preserve source ownership, secrets, existing user changes, and durable data during generation and upgrades. | 9, 17–18, 22 |
| REQ-22 | Support predictable interactive and noninteractive workflows for developers and agents. | 8 |

These are the full target requirements. Delivery stages determine implementation order; they do not remove Firebase alternatives, PostgreSQL, native WebSocket, APNs, or any requested deployment platform from scope. An unfinished capability must be reported as unimplemented, not replaced by a placeholder advertised as working.

### 2.2 Recommended product boundaries

- VCLI is a development tool. Generated applications use normal Nest build/start workflows and run without invoking VCLI.
- The initial supported mutation target is a project created with a supported VCLI blueprint. Adoption of arbitrary existing Nest applications is a separate future workflow.
- Start with one selected implementation for singleton families such as primary identity, database, and realtime transport. Purpose-routed families can compose implementations: FCM for ordinary push plus APNs for VoIP is valid, as are separate diagnostic collection/viewing/query components. Concurrent Firebase/local identity, several realtime protocols in one application, and cross-provider data migration require separate designs.
- Business products such as chat, wallets, stories, ads, rewards, and video calling are not base features. Their reusable infrastructure can be extracted without copying their business rules.
- Full Flutter/React application generation is an open scope decision. Backend contracts and small executable client examples are recommended initially.
- VCLI does not build its own compiler, database, identity provider, container orchestrator, or general observability database.
- Community plugins, an online marketplace, and remote plugin execution are expansion options after the internal extension contracts stabilize.

### 2.3 Intended developer journeys

1. Select a stack interactively or through flags, generate a project, supply external credentials, and start an explicitly chosen development workflow.
2. Generate an application feature without re-answering database, auth, or architecture questions.
3. Add realtime, mail, storage, or another capability to a customized project through a reviewable change plan.
4. Run an isolated E2E scenario and let an agent inspect its assertions, logs, and correlated operations.
5. Prepare a platform-specific deployment, supply private settings, apply it deliberately, and verify the running result.
6. Add a new provider through the documented extension contract and prove it against shared behavior tests.
7. Upgrade a generated project using explicit migrations that preserve developer-owned source and durable data.

## 3. Existing foundations and extraction boundaries

Two distinct source checkouts were examined during discovery. They must not be confused.

| Source | Relevant existing material | Extraction boundary |
| --- | --- | --- |
| `superup_workspace/super_up_api` | Firebase ID-token verification, opaque application sessions, device ownership, Socket.IO integration, FCM/VoIP APNs, SMTP, local/S3 storage, request IDs/errors, Dockerfile and CapRover entry file. | Current product logic and legacy coupling require a curated extraction. |
| `whizpee/backend` in a separate checkout | Owner-based modular architecture, Centrifugo backend admission/publication, structured diagnostics, bounded reports, local developer toolkit. | Different product contracts and infrastructure choices. Useful patterns, not an interchangeable copy of the current backend. |

Representative current-source pointers:

- `super_up_api/src/core/firebase-auth/`: identity verification and app-session lifecycle.
- `super_up_api/src/api/user_modules/user_device/`: installation/device and destination ownership.
- `super_up_api/src/chat/socket_io/`: current transport wiring, coupled to chat and calls.
- `super_up_api/src/common/notification_emitter/`: notification transport and VoIP-specific APNs.
- `super_up_api/src/common/media/`: explicit storage ports, composition, local/S3 adapters, and access/upload lifecycle.
- `super_up_api/src/api/mail/`: SMTP/template starting point.
- `super_up_api/src/core/middleware/request-id.middleware.ts` and exception filters: bounded request correlation and error presentation.
- `super_up_api/Dockerfile`, `docker-compose.yml`, `captain-definition`: deployment starting points with different completeness levels.
- Separate checkout: `backend/centrifugo/`, `backend/src/platform/realtime/`, `backend/src/platform/diagnostics/`, and `backend/test/developer-toolkit/`.

Important findings that affect extraction:

1. Current SuperUp Firebase auth verifies Firebase ID tokens and uses a separate hashed opaque app-session capability. It does not issue a second application authentication JWT. Old local-login/JWT artifacts are retired compatibility remnants, not a complete local-auth implementation.
2. The current Firebase verifier allows password, Google, and Apple, but phone requires new provider and account mapping work.
3. The class named `RedisIoAdapter` currently installs auth middleware; its name does not establish Redis scale-out support.
4. Direct APNs code is tied to VoIP calls. Ordinary APNs must have its own generic contract.
5. Existing FCM code has unawaited SDK calls and commented-out invalid-token cleanup. These must be resolved during extraction.
6. Some current configuration is unsuitable for a generic starter: non-strict TypeScript, wildcard CORS, broad payload limits, product-specific first-run behavior, and mixed naming.
7. Legacy Compose uses standalone MongoDB, which does not establish the transaction topology required by current atomic operations. Its environment wiring also needs reconciliation with the Docker runtime.
8. The existing CapRover definition references a Dockerfile; it does not provision the full service topology.
9. The older backend has useful Centrifugo and diagnostics implementations. Its domain-specific replay, privacy, and operational gates should not silently become universal VCLI policy.

No private environment files, service-account files, credentials, personal admin allowlists, product IDs, account identifiers, production domains, or test identities should enter templates. Preserve applicable licenses and attribution when extracting source; public distribution requires a license review of the extracted material.

Existing source is evidence, not automatically the preferred design. New templates should encode the current coding policy below rather than reproduce legacy inconsistencies.

## 4. Hatem's coding policy and generated application architecture

### 4.1 Required principles

Apply all five SOLID principles through concrete ownership and dependency rules:

- **Single responsibility:** keep transport, application coordination, domain behavior, persistence, and provider mechanics separate.
- **Open/closed:** extend a capability through an implementation or adapter, without spreading provider switches through consumers.
- **Liskov substitution:** replacements preserve documented inputs, results, errors, authorization, and reliability guarantees.
- **Interface segregation:** consumers depend on the small capability they actually need.
- **Dependency inversion:** application behavior receives capability ports; Nest composition selects concrete implementations.

Use one handwritten class per file, including each controller, service, DTO class, repository, model class, and Nest module. Cohesive interfaces, type aliases, constants, and pure helpers may share a file. Preserve tool-owned generated output. This is not a universal one-symbol-per-file rule.

Use kebab-case TypeScript filenames with responsibility suffixes, UpperCamelCase classes/types, lowerCamelCase functions/members, descriptive names, and small cohesive methods. Prefer readonly shapes and discriminated unions where they clarify contracts. Use strict TypeScript in new starters, single quotes, and one approved formatter configuration.

Do not invent a blanket ban on every explicit `any` at unavoidable third-party boundaries. Prefer `unknown` plus validation and narrowly documented boundary exceptions. Do not require annotations on every inferable local variable or interfaces for pure helpers solely to increase abstraction count.

Code and generated engineering documentation use clear English. Product localization is a separate optional capability.

### 4.2 Ownership and layers

Recommended structure for a generated project:

```text
src/
  main.ts
  app.module.ts
  platform/
    config/
    http/
    logging/
    persistence/
    realtime/
  modules/
    identity/
    sessions/
    installations/
    orders/
      domain/
        model/
        behavior/
      application/
        commands/
        queries/
        ports/
      adapters/
        inbound/
          http/
        outbound/
          mongoose/
      public/
        index.ts
      orders.module.ts
```

Only installed capabilities and active feature paths are generated. The SQL adapter path replaces the Mongoose implementation in a PostgreSQL project. The precise top-level names remain reviewable; owner boundaries and dependency direction are the important contract.

Domain code is pure and deterministic. It imports no NestJS, ORM, HTTP DTO, provider SDK, environment reader, logger, or telemetry service. It performs no network/database I/O and receives time, actor, randomness-derived values, and provider facts explicitly when needed.

Application commands and queries are plain classes/functions depending on ports. Nest modules and factories compose them. Controllers and gateways parse input, obtain trusted identity, call application operations, map results, and perform required transport instrumentation.

Each owner controls its persistence and invariants. Other owners consume deliberate public capabilities, views, errors, and injection tokens through `public/index.ts`. Importing a foreign owner's internal document/model is disallowed, including type-only imports. Avoid `forwardRef()` and global locators as ways to conceal dependency cycles.

Shared platform code handles infrastructure mechanics. It must not become a collection of unrelated business rules.

### 4.3 Data, validation, transactions, and errors

- Separate transport DTOs, domain values, and persistence representations with explicit mapping.
- Validate external types, allowed keys, sizes, ranges, and content. Trusted actors come from verified context rather than request body fields.
- Enforce business invariants in application/domain behavior and durable integrity through database constraints or guarded writes.
- Use descriptive camelCase fields for new generic models. Preserve legacy shortened Mongo fields only within deliberate extraction/migration adapters; do not expose parallel spellings indefinitely.
- Keep database handles, Mongo sessions, ORM query objects, and arbitrary filters out of pure application/public contracts.
- Coordinate an atomic operation through one workflow and shared opaque transaction context. Participants do not independently commit.
- Do not run provider/network calls or `Promise.all` inside a retryable transaction callback.
- Preserve command identity and authorization through retries. Resolve uncertain commits rather than treating a lost response as proof of rollback.
- Emit side effects after the required commit boundary. Use durable intent/outbox only when the operation promises durable dispatch.
- Use stable error codes and safe transport mappings. Keep internal errors and sensitive data out of public responses.
- If a future feature handles money, preserve exact representations and its required transaction/ledger semantics. A wallet or ledger is not a universal starter dependency.

## 5. Extensibility contract

### 5.1 What must be replaceable

The design must expose stable boundaries for identity verification, password credential management, session persistence, database transactions, realtime publication/admission, mail, push, object storage, job execution, diagnostics storage/querying, deployment targets, and generator transformations.

The CLI itself must be extendable: new generators and feature recipes should register declaratively, rather than require a new conditional branch in every command implementation.

An abstraction should describe a useful capability, not mirror a vendor SDK. Separate smaller contracts where consumers need different operations. Example names:

| Capability | Example responsibility |
| --- | --- |
| `PrincipalVerifier` | Convert supported credentials into a verified principal. |
| `SessionAuthorizer` | Resolve current session authority under the documented revocation policy. |
| `SessionReader` / `SessionRevoker` | Read safe session projections or revoke selected ownership. |
| `RealtimePublisher` | Publish a typed event to an authorized audience. |
| `MailSender` | Attempt an email delivery and return a typed result. |
| `PushSender` | Attempt delivery to explicitly typed destinations. |
| `ObjectReader` / `ObjectWriter` / `TransferIssuer` | Read/write objects or issue bounded transfer capabilities. |
| `JobScheduler` | Record or schedule work under a declared delivery contract. |
| `DiagnosticReader` | Query bounded, authorized retained evidence. |
| `DeploymentAdapter` | Translate a service plan and operate a selected platform. |

Names and signatures are proposed. A provider must not satisfy an interface by silently returning fake success or ignoring unsupported semantics.

### 5.2 Capabilities and differences

Keep a small common contract and explicit optional capabilities. Realtime replay, presence, client commands, and acknowledgements are separate from basic publication. Storage multipart support is separate from a basic object write. An unsupported operation produces a clear planning or runtime capability error, according to its contract.

Dependency injection selects implementations at composition boundaries. Provider SDK types stay inside adapters. A provider change may require configuration, client, schema, data, or deployment migrations even when business use cases keep the same interface.

Extensibility does not imply interchangeable wire protocols or instant data portability.

### 5.3 Extension acceptance test

A reviewer should be able to add a new SMTP-compatible email preset, S3 provider preset, diagnostic reader, or deployment target by:

1. Implementing any genuinely new adapter against the existing capability.
2. Registering its recipe, configuration schema, requirements, and compatibility.
3. Adding templates/transforms only where its generated integration differs.
4. Adding setup documentation and safe examples.
5. Passing shared contract tests and provider-specific acceptance tests.

Existing business consumers and unrelated providers should not require edits. Changes to the stable contract require an explicit versioned evolution and consumer migration plan.

Example: an S3-compatible provider that meets the existing contract may need only a preset and compatibility tests. A provider with different integrity guarantees may need an adapter or an explicitly narrower capability; do not disable checks silently to make it fit.

### 5.4 Recipe contents

Each recipe should declare its ID/version, supplied capabilities, required capabilities, optional integrations, conflicts, options, configuration keys, compatible toolchain/database/platform versions, templates, transforms, dependency declarations, docs, migrations, checks, and ownership policy. Declare capability cardinality: singleton selection, purpose-keyed routing, or independently composed roles. Do not treat every provider family as mutually exclusive.

Resolve dependencies on capabilities where practical. An authenticated gateway requires identity/session authority, not inherently Firebase. FCM messaging configuration does not inherently require Firebase Authentication. Local password reset requires mail delivery; Firebase-managed authentication email may not.

Recipes should fail early for dependency cycles, incompatible exclusive implementations, unsupported options, and absent prerequisites. Presets select recipes; they must not maintain separate copies of their implementations.

Resolve dependencies deterministically. Prefer an already selected compatible implementation; otherwise use an explicitly declared preset default or require selection when several implementations qualify. Registry order must never decide a provider or security policy, including under `--yes`.

## 6. CLI implementation architecture and rationale

### 6.1 Recommended structure

Use a standalone TypeScript command interface with a small capability planner and change-plan executor. Keep ordinary Nest build/start tooling. Initial source can live in one package with clear internal directories; create separately published packages only for independent versioning or ownership needs.

```text
vcli-toolkit/
  src/
    commands/
    project/
    capabilities/
    planning/
    transforms/
    execution/
    diagnostics/
    deployments/
  recipes/
  templates/
  examples/
  tests/
```

Candidate tools include a standard command parser, an optional prompt library, a template engine, and TypeScript AST tooling such as ts-morph. Specific libraries, versions, bundler, and test runner remain open decisions. Avoid adding several libraries for the same responsibility.

### 6.2 Schematics versus a standalone transformation layer

Nest custom collections are a valid extension point. Schematics offers a virtual file tree and established generator infrastructure. A custom planner offers direct control over capability lifecycle, service planning, diagnostics, and deployment operations.

**Recommended:** own VCLI's capability and planning contracts, and use templates plus syntax-aware transforms behind those contracts. Schematics can implement part of the transformation layer or provide a later `nest g` bridge.

Neither Schematics nor ts-morph automatically supplies dependency resolution, safe upgrades, idempotence, recovery, or compatibility. Do not import private Nest CLI internals as a stable application API. Two public entry points must call the same generation implementation.

Before final engine selection, implement a bounded comparison after design approval: add authenticated realtime to a customized generated app, preview it, repeat it, and encounter a conflicting edit. Compare output correctness, preservation of comments/customizations, diagnostics, dry-run fidelity, dependency footprint, and implementation complexity.

### 6.3 Lessons retained from the six proposal reviews

Retain feature manifests and project state; staged edits; normal generated source; distinct session and push concepts; existing Nest build/start; measured architecture checks; and real generated-app tests. Reject claims that agent Markdown forces compliance, a generation library guarantees future compatibility, a user room supplies complete multi-device semantics, a lock decorator guarantees correctness, or a generic flag supplies durable offline synchronization.

The exact command parser or template library is less important than these contracts. Public plugin execution also introduces dependency and code-execution trust; begin with curated local recipes and review external plugin distribution separately.

## 7. Project configuration and state

### 7.1 Files and ownership

| File/category | Purpose | Ownership |
| --- | --- | --- |
| `vcli.json` | Desired project choices and nonsecret settings. | Developer-editable, schema-validated, committed. |
| `vcli.lock.json` | Resolved recipe/blueprint versions, applied migrations, and managed-file provenance. | Tool-maintained, committed; exact structure open. |
| `.vcli/local/` | Local process ownership, ports, temporary plans, diagnostic run references. | Machine-local and ignored. |
| Private environment files or secret store | Secret values and environment-specific private configuration. | Developer/deployment-owned; never committed by VCLI. |
| Verification artifacts | Actual check results, environment identity, release/run IDs, limitations. | Separate from desired configuration; retention controlled. |

The lock record is not a duplicate package-manager lockfile. Do not hash/store private environment contents in public provenance or include credentials in plan output.

### 7.2 Illustrative project configuration

This example deliberately combines local auth, MongoDB, and Centrifugo to demonstrate independent choices. It does not establish defaults.

```json
{
  "schemaVersion": 1,
  "project": {
    "name": "orders-api",
    "architecture": "modular-monolith",
    "packageManager": "pnpm"
  },
  "database": {
    "driver": "mongodb",
    "adapter": "mongoose",
    "connection": "env:DATABASE_URL"
  },
  "auth": {
    "driver": "local",
    "methods": ["email-password"],
    "accessCredential": "jwt",
    "sessions": "multi-device"
  },
  "realtime": {
    "driver": "centrifugo",
    "admission": "backend-proxy"
  },
  "mail": {
    "transport": "smtp",
    "authEmails": "application-mail",
    "applicationEmails": true
  },
  "push": {
    "routes": [
      { "purpose": "ordinary", "driver": "fcm" },
      { "purpose": "voip", "platform": "ios", "driver": "apns" }
    ]
  },
  "storage": { "driver": "s3", "provider": "aws" },
  "observability": {
    "collector": "vector",
    "viewer": "logdy",
    "testEvidence": "jsonl",
    "mcp": "read-only"
  },
  "environments": {
    "development": { "services": "compose" },
    "production": { "deployment": "dokploy" }
  }
}
```

The Firebase branch has its own validated options:

```json
{
  "auth": {
    "driver": "firebase",
    "providers": ["email-password", "phone", "google", "apple"],
    "sessions": "multi-device"
  },
  "mail": {
    "transport": "smtp",
    "authEmails": "firebase-managed",
    "applicationEmails": true
  }
}
```

Use discriminated schemas so local-only and Firebase-only settings cannot be combined accidentally. PostgreSQL specifies one approved adapter and migration tool once selected. Environment overrides may change endpoints, secret references, retention, and supported infrastructure settings; a runtime environment switch cannot silently substitute a different ungenerated database/auth implementation.

### 7.3 Reconciliation and status

Changing desired configuration creates a plan. It does not immediately rewrite custom code, migrate data, rotate credentials, or contact a deployment platform. Unknown schema versions and unsupported migrations fail clearly.

Generators use the reconciled, realized recipe configuration recorded by the project state. If generation-relevant desired choices differ from that state, stop with a reconciliation plan rather than generating against an uninstalled stack. Editing `database.driver` alone must not make the next repository generator insert PostgreSQL source into a Mongo application. Validate realized state against the touched source/dependencies as well; a lock entry alone does not prove an intact installation.

Track selection, generated source, dependency installation, configuration, reachability, and behavior verification separately. Realization records distinguish source applied, installation pending/failed, and checks pending/failed; writing source must not mark the whole capability complete. Operational commands use the realized topology and report unresolved setup. A prior check must identify its version/environment/time and must not remain a timeless green flag after relevant changes.

One capability catalog should drive JSON validation, interactive prompts, CLI options, environment examples, help, generated documentation, compatibility checks, and recommended verification. Resolve drift through explicit reconciliation rather than accumulating contradictory rule files.

## 8. Command surface and developer experience

All commands below are proposed. Recommend `init <name>` for a new directory and `init .` for the current empty directory. Arbitrary existing-project adoption remains separate.

```sh
vcli init orders-api --db mongodb --auth firebase
vcli init inventory-api --db postgresql --auth local

# Inside a generated project, use its pinned local CLI.
pnpm exec vcli inspect --json
pnpm exec vcli capabilities --json
pnpm exec vcli add realtime --driver centrifugo --dry-run
pnpm exec vcli add realtime --driver centrifugo --yes
pnpm exec vcli add mail --driver smtp
pnpm exec vcli add storage --driver s3 --provider aws

pnpm exec vcli g feature orders
pnpm exec vcli g command confirm-order --feature orders
pnpm exec vcli g query list-orders --feature orders
pnpm exec vcli g controller orders
pnpm exec vcli g dto create-order --feature orders
pnpm exec vcli g repository order-records --feature orders
pnpm exec vcli g service availability --feature orders
pnpm exec vcli g gateway order-events

pnpm exec vcli doctor --json
pnpm exec vcli check
pnpm exec vcli services plan --env development
pnpm exec vcli dev
pnpm exec vcli test e2e --capture
pnpm exec vcli diagnostics mcp
pnpm exec vcli deploy plan --target dokploy --env production
pnpm exec vcli deploy apply --target dokploy --env production
pnpm exec vcli deploy verify --env production
pnpm exec vcli upgrade --dry-run
```

### 8.1 Command contracts

- `init`: creates the selected source/config/docs and offers a separate dependency-install step. It does not silently provision paid services or deploy.
- `add`: resolves required capabilities, shows their changes, and integrates them into supported generated projects.
- `generate`: validates desired versus realized project state and creates correctly located code for the reconciled configuration. If a required capability is missing, it reports or plans the addition.
- `inspect`/`capabilities`: exposes selected, installed, supported, and unresolved capability information.
- `doctor`: checks configuration/tool compatibility by default. Network/provider probes require an explicit live-check option and report their scope.
- `check`: runs measured static architecture/type/lint checks. It is not synonymous with provider or deployment validation.
- `dev`/service commands: operate only identified project services/processes, preserve persistent data on ordinary stop, and report ownership.
- `test e2e`: operates a declared isolated test environment and records assertions plus diagnostics.
- `deploy`: separates a concrete platform plan, explicit mutation, and live verification.
- `upgrade`: proposes supported migrations with conflicts and verification requirements.

### 8.2 Human and agent behavior

Mutation commands support relevant `--dry-run`, `--yes`/noninteractive, and `--skip-install` options. Inspection/planning/check commands support structured JSON, stable error codes, and useful process exit status. Exact flag spelling and exit-code assignments are review decisions.

`--yes` accepts documented safe defaults; it does not suppress conflicts, invent required security choices, or authorize destructive data replacement. Noninteractive commands fail with missing-input details instead of hanging for input. JSON output excludes secrets and separates data from diagnostic stderr.

Future generations reuse recorded choices. Avoid repeated prompts for already selected auth/database/provider settings. Provide specific errors such as unsupported combination, modified-file conflict, missing configuration, dependency-install failure, and incomplete external setup.

### 8.3 Generator responsibilities

An operation generator should create the required input mapping, application operation, ports/adapters where needed, public exports, Nest composition, API descriptions, and meaningful behavior checks. It must not create an interface for every helper or empty architecture folders.

Executable behavior requires an explicit input/output and authorization contract. A name-only invocation creates a clearly unfinished, unexposed scaffold with the required structure; it must not infer business rules, expose permissive routes, or generate passing assertions that pretend to test behavior not yet defined. Only generate API descriptions and behavior checks to the extent supported by the supplied contract.

`g service` needs enough responsibility/layer information to avoid putting transport, business, and provider work into one generic service directory. Generation must follow the chosen architecture, not only filename suffixes.

CRUD generation is optional. It requires an explicit schema and authorization/ownership policy, or produces an unexposed scaffold pending those decisions. The generator must not invent permissive public endpoints, editable ownership fields, or unrestricted database queries.

## 9. Generation lifecycle, idempotence, and recovery

Recommended lifecycle:

```text
Discover project and local CLI version
  → validate manifest/options/support matrix
  → resolve capability dependencies and conflicts
  → inspect existing touched files
  → construct one source/config/docs/dependency change plan
  → preview or apply with precondition checks
  → optionally install declared dependencies
  → run selected verification
  → record actual outcome and next steps
```

Use templates for new files, syntax-aware edits for supported TypeScript constructs, and structured editors for JSON/configuration. Do not modify complex TypeScript using broad regular expressions.

The plan records expected versions, expected existence/absence for every touched path, and expected contents/hashes for existing nonsecret files. Apply rechecks them, including after another agent/editor creates a proposed new file or changes an existing one. Unsupported source shapes fail explicitly. A project-scoped lock can prevent simultaneous VCLI mutations; it does not replace content preconditions for ordinary editor changes.

Repeated addition must not duplicate imports, providers, routes, configuration keys, documentation blocks, or indexes. Installed-but-damaged or partially completed additions must be diagnosed rather than reported as an unconditional no-op.

Dry runs write no project files, install nothing, and mutate no external system. A separate explicit planning command may save a plan when requested. Applying a saved plan must detect stale inputs.

Stage source/config/doc changes and retain recovery metadata. If interrupted, report which steps completed. Restore only VCLI-owned writes whose current content still matches that operation; never reset the repository or overwrite newly appearing edits.

Package installation, database migrations, and provider/deployment actions are separate fallible phases. The whole workflow is not one atomic filesystem/network transaction. Mark dependency-install failures accurately and provide a retry path. Source generation success is not runtime success.

Reject path traversal and writes outside the intended project. Template identifiers and command arguments are validated data, not shell fragments. Respect symlinks and existing files deliberately. No broad cleanup, cache deletion, or volume removal is part of ordinary generation.

## 10. Standard application foundation

Recommended foundation:

- Strict TypeScript, one formatter/linter policy, editor conventions, and pinned compatible tooling.
- Typed, conditional configuration validation with safe startup errors.
- Consistent API prefix/versioning; preserve the intent of the current `@V1Controller` convention without hardcoding product names.
- Validated input, bounded body/upload limits, explicit CORS, appropriate HTTP security middleware, and configurable throttling.
- Stable public errors and safe diagnostics with request correlation.
- OpenAPI configuration and protected/documented production exposure policy.
- Liveness/readiness, graceful shutdown, and bounded dependency timeouts.
- Focused verification scripts, isolated test helpers, and documentation.
- Reproducible container definition without unrelated media tools unless selected.

Choose a consistent default JSON response convention. Downloads, streams, redirects, `204`, health endpoints, and externally required webhook responses may need explicit exceptions. Preserve meaningful HTTP statuses; avoid double-wrapping.

The foundation does not automatically install Firebase, Redis, a queue, a storage SDK, a UI framework, or every observability service. Tooling such as Git hooks and CI-provider configuration is a deliberate profile choice. VCLI's own release validation is separate from the checks developers run for each small application change.

## 11. Database and concurrency contracts

### 11.1 Supported families

MongoDB and PostgreSQL are both required targets. Recommend Mongoose for the Mongo adapter to reuse current experience. The PostgreSQL library and migration tooling remain open; choose one implementation initially rather than supporting several ORMs at once.

Use `--db mongodb` or `--db postgresql`. If a `--sql` shortcut is provided, resolve it to an explicit supported database/adapter and record that choice.

### 11.2 Behavior parity

The database adapter must implement owner-specific capabilities, not a public universal CRUD/query abstraction. Shared behavior tests cover identity uniqueness, atomic session enrollment/revocation, refresh/reset races, guarded updates, pagination semantics, idempotent acceptance, and uncertain outcomes where promised.

Indexes, relational constraints, schema validation, isolation, migration mechanisms, and query implementation remain database-specific. Public identifiers have an explicit wire contract; do not expose Mongo document machinery or assume every provider has the same identifier representation.

For Mongo features that require transactions, generate/validate a suitable replica-set topology. A local single-node replica set can be a development recipe; production topology is an operational decision. Do not silently fall back to sequential writes while claiming atomicity.

PostgreSQL needs explicit schema migrations, constraints, connection pooling, and a one-time release migration strategy. Applied migrations are immutable; add a new migration for later changes. Database initialization and migration must not reset existing data.

Logical expiry is checked during authorization or business operations. Asynchronous TTL/cleanup is housekeeping, not the correctness boundary.

### 11.3 Idempotency and side effects

Idempotency support is operation-specific: scope the key, validate payload identity, retain an authorized result, enforce uniqueness/atomic mutation, and define in-progress and uncertain outcomes. A Redis lock or decorator alone does not provide this guarantee.

An outbox/job mechanism is selected when durable dispatch is required. Keep external calls outside retryable database transactions. Database/queue/provider failures must not cause a new unrelated command identity to replace an accepted operation.

Changing a project's database is a migration project. Stable application ports reduce coupling; they do not automatically convert existing data or make queries equivalent.

## 12. Authentication, accounts, installations, and sessions

### 12.1 Common concepts

| Concept | Meaning |
| --- | --- |
| Identity method/provider | How the user proves identity: Firebase methods or local password credentials. |
| Credential issuer | Who issues the API credential; JWT is a format, not an identity provider. |
| Account | Application-owned user identity and authorization. |
| Installation | An app installation/browser storage context; an installation ID does not prove physical hardware identity. |
| Session | A revocable authenticated login with its own lifecycle. |
| Connection | A transient socket or transport connection; several can share a session. |
| Push destination | Provider, application/environment, token, purpose, and current ownership. |

Both identity modes supply provider-neutral verified principal/account/session capabilities. Firebase SDK claims, ORM documents, and token payload mechanics remain at adapters. Multi-device behavior is part of the supported authenticated application profiles.

### 12.2 Firebase recipe

Support selectable email/password, phone, Google, and Apple. The client Firebase SDK normally conducts provider sign-in and refresh; the backend verifies Firebase ID tokens and applies account/session authorization.

Recommended reuse: retain an opaque application-session capability for independently revocable device sessions, with only its hash stored. Firebase ID-token refresh must not become an account change or create a replacement application session.

Session enrollment needs its own authority policy. Require sufficiently recent Firebase authentication and an enrollment cutoff/generation for applicable revocation events, with explicitly defined account/session scope. A revoked client must not regain access by presenting the same old Firebase proof and a new installation/session identifier. Preserve other authorized active sessions and ordinary token refresh according to the selected revocation scope; genuine reauthentication can establish a new authorized session.

Do not automatically issue another access/refresh-token system on top of Firebase. If such an exchange is needed later, give it a separate reviewed contract.

Phone-only users may have no email. A verified identity phone number is different from a profile contact number. Account provisioning must be idempotent under concurrent first use. Link identities using stable verified provider ownership and explicit user actions; never merge accounts solely because email text matches. Unlinking the last usable method needs a recovery policy.

Generate backend provider policy, configuration requirements, client request examples, setup instructions, and checks. External provider enablement, domains/redirects, phone/app verification, Apple keys/app registration, and real native flows still need configuration and acceptance. Do not present generated source as operational provider setup.

### 12.3 Local email/password and JWT recipe

This is required full functionality, not a future substitute for Firebase or a token-signing snippet.

The recipe includes registration/login; canonical identifiers and uniqueness; password policy and secure hashing; email verification/resend; safe reset/change-password flows; throttling; deliberate account-enumeration behavior; signing-key configuration; strict access-token validation; session association; and logout/revocation.

Recommend Argon2id subject to approved library/runtime support and measured parameters. Short-lived access JWTs must validate issuer, audience, algorithm, expiry, and key identity. Refresh credentials should be opaque, expiring, hashed at rest, and rotated atomically with token-family/session association.

Refresh reuse detection needs a documented concurrent-refresh and lost-response policy. A consumed token can indicate theft or a legitimate retry; the design must handle that ambiguity deliberately. Prevent uncontrolled new token families and avoid accidentally revoking a replacement login.

Reset/verification tokens are purpose-bound, expiring, one-use, and atomically consumed. Specify what password change/reset does to existing sessions. Mail delivery failure must not fabricate a completed user action.

Specify browser cookie versus native bearer-token transport, secure cookie attributes/CSRF where applicable, recent-auth requirements, and signing-key rotation. A self-contained JWT cannot promise immediate logout without current authority checks; choose and document server-session checks or a bounded expiry policy. Recommend shared server-side session authority for the multi-device profile.

### 12.4 Shared session lifecycle

Support safe session listings and current/selected/others/all revocation with caller ownership checks and recent authentication for sensitive remote actions. List projections never expose credentials or hashes.

Revocation affects HTTP authority, realtime authority, and active push ownership according to documented bounds. Capture account/session/environment/generation when asynchronous work starts; obsolete completions must not clear or act on a newer login. Installation rebinding and push-token rotation need the same protection.

Account disable/delete coordinates application state and provider effects with recoverable partial failure. Provider cleanup is not one transaction with local persistence. Define retained intent and retry behavior where required.

API credentials, Firebase tokens, Centrifugo grants, media transfer URLs, and provider server keys are purpose-specific. They must not become interchangeable credentials.

## 13. Authentication email and application mail

Use distinct selections for transport and permitted message workflows:

- `transport: smtp | development-capture | none | future-provider`: the configured delivery mechanism.
- `authEmails: firebase-managed`: Firebase owns authentication actions and its managed email flow.
- `authEmails: application-mail`: local-auth actions or Firebase-generated action links are delivered through the selected mail capability.
- `applicationEmails: true | false`: whether the application exposes general mail capability for invitations, receipts, reports, and product messages.

Local authentication can use SMTP for verification/reset while general application email remains disabled. Local-auth actions and custom-delivered Firebase links require the selected mail transport; Firebase-managed authentication email does not. A provider replacement changes the delivery adapter, not the authentication workflow or product-mail permission policy.

“Firebase SMTP” is ambiguous. Firebase authentication action links can be generated by the Admin SDK and sent using custom SMTP; that does not make Firebase Authentication a general application SMTP transport [S01].

The SMTP recipe supplies typed host/port/security mode, sender configuration, private credentials, template rendering and asset copying, awaited attempts, typed outcomes, timeouts, and documented retry behavior. Use one generic `MailSender` contract rather than coupling mail to a product user document.

Provide a development capture transport and examples for assertions. Local password verification/reset depends on working mail or an explicitly development-only capture setup. Production must not silently use a fake delivery transport.

Queued acceptance, provider acceptance, and inbox delivery are different evidence. A provider timeout can leave an uncertain outcome; avoid claiming exactly-once email delivery.

## 14. Push notifications and device destinations

FCM and APNs capabilities are required. Keep ordinary notifications, background/silent behavior, and VoIP as explicit purposes. FCM can carry ordinary Apple notifications; direct APNs/VoIP is selected when needed rather than installed automatically beside it.

A destination has explicit provider, token type/purpose, app/environment, installation/account binding, version/generation, and status. Do not infer providers from token shape or store a single `users.fcmToken` field.

Implement authenticated registration, rotation/upsert, ownership transfer, last-seen information, revocation, invalid-token cleanup, bounded batching, and awaited provider attempts. An old failure must not delete a newly rotated token. Queued work must recheck relevant ownership before disclosure after an account switch.

Recommend one active provider per installation/purpose unless a deliberate routing policy selects more. Deduplicate destinations and use stable notification IDs. Retries, queues, or an outbox do not alone prove exactly-once device display after an ambiguous response.

Native APNs credentials, entitlements, app configuration, and real device acceptance are external setup. Background push is not a durable synchronization protocol. A provider-accepted response does not establish recipient observation.

## 15. Realtime implementations

### 15.1 Shared contracts

Use a small typed publication/admission contract with optional capabilities for presence, subscription authorization, client commands, and recovery. Business code should not import Socket.IO, `ws`, or Centrifugo SDK objects.

Durable business operations use application commands with explicit authorization and idempotency where required. Recommend HTTP commands plus realtime notifications as a simple default. Explicit client-command support can use the same application operations without putting business rules in gateways.

A provider selection does not promise universal replay, exactly-once delivery, ordering across all streams, or offline synchronization. Each recipe declares supported guarantees and recovery behavior.

### 15.2 Socket.IO

Generate the Nest adapter/gateway, trusted connection context, event input validation, typed payloads, acknowledgements/errors, audience/room authorization, expiry, revocation, reconnect behavior, and a client example.

Rooms provide fan-out, not complete multi-device authority. Handle multiple tabs/sockets sharing a session without disconnecting valid siblings accidentally. Authorization must continue after handshake, including idle expiry and permission/revocation changes.

Multi-instance support is an explicit tested recipe. It includes a real adapter, shared authority/invalidation behavior, and load-balancer configuration. Polling requires suitable sticky routing or an explicit WebSocket-only transport selection; Redis alone is insufficient [S04].

### 15.3 Native WebSocket

Prefer Nest's supported `ws` adapter where suitable. Define the application's envelope, event names, payload schema, correlation/ack/error behavior, authentication, heartbeat, limits, backpressure, and reconnect guidance. Native WebSocket clients do not automatically speak Socket.IO or Centrifugo protocols [S04].

Avoid long-lived credentials in logged URLs. Select a browser-compatible authentication admission method and document its expiry and trust boundary. Audience routing and optional presence require actual implementation, not an interface stub.

### 15.4 Centrifugo

Generate a separate service/configuration, public client endpoint, private server API, health checks, selected engine setup, backend admission/publish/disconnect integration, authorized channel policy, secrets references, and executable client example.

Centrifugo supports direct connection/subscription grants and backend proxy hooks [S05]. Recommend a backend-proxy recipe for current session checks, informed by the existing Whizpee implementation. Direct grants are a valid alternate recipe with explicit expiry and revocation behavior. Keep admission grants and server API keys separate from application API credentials.

MongoDB/PostgreSQL retain business data and session authority. Generate Redis only when the selected Centrifugo engine/profile requires it. Do not invent a second product database for Centrifugo.

Define who can connect/subscribe/publish, current authority checks on reconnect/refresh, and cross-instance revocation bounds. Keep administrative/server endpoints private. Provider publication failure and missed hints require the documented application recovery path; history options are not a generic durable sync system.

Changing realtime providers in a customized project needs a backend/client/deployment migration plan, even if application publication ports remain stable.

## 16. Storage and media

Support local disk, AWS S3, and named verified S3-compatible presets behind small read/write/transfer capabilities. A generic custom endpoint is possible, but “endpoint accepted” is not a compatibility claim.

Separate basic object storage from media processing, thumbnails, transcodes, antivirus integration, and product-specific retention/one-view behavior. Install processing tools only when selected.

Required storage behavior includes private-by-default access, safe object keys/paths, ownership authorization, upload bounds/type checks, integrity checks where promised, finalization, orphan cleanup, explicit deletion/retention, and bounded download grants. Durable records hold stable references rather than expiring signed URLs. Transfer endpoints must not receive unrelated application credentials.

Finalized metadata must bind to immutable verified bytes or an explicit object version. Use a reviewed staging/promotion or equivalent fencing mechanism so a replayed upload grant or delayed multipart completion cannot overwrite the finalized content. Already-issued external transfer grants are independent capabilities: API/session revocation does not automatically invalidate an S3 signed URL. Declare maximum remaining validity and any stronger proxy/provider enforcement, and verify that advertised bound.

Local storage must prevent path traversal/symlink escape and keep private objects outside static public roots. Production requires persistent storage and a declared replica/placement policy. A local volume on one node does not become shared storage when replicas increase.

S3 presets declare endpoint/region/addressing behavior and verified support for presigned PUT/GET, CORS, checksums, conditional writes, head/range reads, multipart when selected, encryption, and lifecycle/versioning requirements. R2's documented compatibility differences demonstrate why a custom endpoint alone is insufficient [S11]. Unsupported integrity semantics require a reviewed alternative or an explicit unsupported result.

Optional tenancy must propagate through metadata, authorization, quotas, cleanup, and destination ownership. Random object keys are not tenant authorization. Tenant isolation is an extension decision, not an implicit claim of every starter.

## 17. Environment configuration and local infrastructure

### 17.1 One conditional schema

Generate typed runtime validation, `.env.development.example`, `.env.production.example`, safe variable documentation, deployment variable mappings, and doctor checks from one capability-aware schema. Generate ignored private `.env.development` and, when requested for file-based deployment, `.env.production` without overwriting existing values.

Recommended precedence: explicit process/deployment environment overrides the selected private environment file; code defaults apply only where declared safe. Production may run entirely from injected environment/secret references without a private env file. Never silently load development configuration because a production variable is missing.

Private files use restrictive user-only permissions or the platform equivalent and remain ignored. Exclude them from container build contexts and images; never pass secret values through ordinary build arguments or embed them in image layers. Build-time secret requirements need an explicitly supported secret mechanism.

Mark secret values, required names, safe defaults, validation bounds, and provider-conditional settings. Do not print full resolved configuration. Production rejects development-only automation/capture settings unless the selected operation explicitly defines a safe production equivalent.

Generate new application-owned secrets only for missing values during an explicit setup action. Preserve existing credentials and support intentional rotation separately. External Firebase/Apple/SMTP/storage credentials cannot be fabricated by scaffolding.

### 17.2 Service plan

The infrastructure plan accounts for API processes, workers, schedulers, database, cache/queue Redis roles, Centrifugo, storage, Vector, Logdy, and selected evidence backend. Every dependency is either generated/managed or an explicit external endpoint.

Recommended local choices: Compose services or existing native/external services. Do not require Docker for a source-only generation or basic static check. Local startup selects one explicit profile and tracks task-owned processes/ports.

Generate correct dependency health/readiness, private service networking, persistent volumes, and documented startup order. Cache Redis and durable queue use may need different persistence/eviction policies; one Redis service should not silently satisfy conflicting requirements. Schedulers and release jobs require explicit replica ownership.

Ordinary stop preserves databases, uploads, logs within retention, and volumes. Reset/destructive cleanup is a separate explicit action with identified targets and recovery expectations.

### 17.3 Resource policy

Show required tools, downloads, images, and estimated storage when practical before running setup. Reuse compatible installed tools and caches. Do not silently start containers during generation.

For development on Hatem's machine, downloads above 500,000,000 bytes require explicit authorization for the whole operation; do not split batches to bypass the threshold. Do not delete unrelated files/caches or create emulators to make a task pass. This personal machine policy belongs in local contributor guidance/configuration, not as an unexplained restriction imposed on every downstream user.

## 18. Deployment adapters and operations

Dokploy, Coolify, and CapRover are all target platforms. A common service plan feeds separate adapters. Each adapter must account for images/builds, runtime variables/secrets, commands, ports/domains/TLS, proxy/WebSocket behavior, private networking, volumes, workers, migrations, healthchecks, and release identity.

| Platform | Documentation-backed consideration |
| --- | --- |
| Dokploy | Compose/Stack modes differ; UI environment values still require injection into services. Mount/volume handling is platform-specific [S08]. |
| Coolify | Source, image, and Compose deployment paths have different replacement behavior. Health/readiness and persistent storage must match the selected path [S09]. |
| CapRover | Compose import supports a limited experimental subset. Do not assume arbitrary Compose keys or lifecycle behavior are preserved [S10]. |

Do not advertise one unchanged Compose file as a complete deployment recipe for all platforms.

### 18.1 Workflow

1. Produce an explicit target/environment plan and required private settings.
2. Validate supported versions/topology and report unresolved setup.
3. Generate artifacts or use an authenticated platform adapter when deliberately invoked.
4. Build/push/use an identified image, apply configuration, and run controlled release migrations.
5. Verify selected services, readiness, a relevant application interaction, and deployment identity.
6. Record what was verified and any remaining external/provider checks.

Before apply, revalidate the target project/environment, platform resource identities, release/image identity, and relevant current settings. Record created/reused resources and completed steps. Report partial outcomes and reconcile ambiguous API timeouts before retrying provisioning. Resume only the remaining supported operations, preserving durable volumes and existing credentials; stale platform state requires a refreshed plan.

Project initialization must not create paid accounts, alter DNS, replace production credentials, or deploy as a hidden side effect. Platform mutation permissions are separate from read-only diagnostic access.

### 18.2 Durable state and recovery

Use non-root application containers and required ingress only. Keep database/cache/internal provider APIs private by default. Set appropriate resource/body limits, graceful shutdown, and readiness behavior.

Database migrations execute once through a defined release coordinator, with concurrency control and failure reporting. Application rollback does not automatically reverse schema changes. Prefer compatible expand/contract changes where needed.

Specify backup ownership, retention, and restore procedures for database and local/object state. Before advertising a backup recipe, exercise a restore. Preserve known-good data during release failure and do not replace volumes during normal redeployment.

Multiple replicas require verified shared-state/fan-out/revocation and storage behavior. A single-instance deployment cannot establish horizontal scaling support.

## 19. Observability, Vector, Logdy, and E2E evidence

### 19.1 Roles and data path

```text
Nest API/workers + selected DB/infrastructure logs
        → collection, parsing, normalization, redaction
        → retained bounded evidence or selected query backend
        → developer viewer + read-only diagnostics MCP

E2E assertions, client observations, and run artifacts
        → evidence for the same isolated test run
```

Use one structured application logger; Pino is the recommended candidate, subject to dependency review. Vector is the selected collection/transformation integration, and Logdy is the selected live-view integration. Keep retained querying behind a separate capability.

Vector documents collection/transformation/routing; its Docker source is best-effort [S06]. Logdy documents live viewing with an in-memory ring buffer, and its public REST reference documents ingestion [S07]. Those facts do not establish a durable query/MCP contract. LogdyPro is a separately evaluated option, not a presumed dependency.

For local test evidence, recommend bounded rotated JSONL plus a small reader. Production may select a retained query backend. Do not build a general log database into VCLI. Keep the app useful if an optional viewer/collector is stopped.

### 19.2 Event schema and correlation

Use bounded fields such as schema version, UTC event time, service, environment, instance/release, severity, event name, route template, error code, request/trace ID, operation/job ID, and test-run ID when available. Keep source and parse status when normalizing infrastructure logs.

Propagate approved context across async work and queues. A database server line does not inherently have the matching API request ID; dependency observations/tracing provide that relationship. Nearby timestamps alone do not establish causality.

Collect selected project sources, not unrelated host containers by default. Do not enable every raw database statement/parameter. Allowlist diagnostic fields before output, redact again at collection/query boundaries as needed, and keep headers, cookies, credentials, bodies, signed URLs, raw provider responses, and private documents out of normal logs.

Keep Logdy and diagnostic endpoints on loopback/private networks by default. Remote access requires an explicitly authenticated, authorized route. Declare collector privileges separately from viewer/MCP privileges. A read-only filesystem mount of a Docker socket does not make the Docker API read-only: prefer narrowly scoped log access or an explicitly reviewed isolation/proxy boundary, and never expose that authority through the diagnostic tools.

Bound buffering, event size, retention, query ranges, and result size. Report dropped events, disconnected sources, ingestion delay, and truncation. Logging failure must not trigger business retries or unbounded application queues. Keep audit evidence distinct from best-effort operational logging when an application needs a durable audit trail.

### 19.3 MCP tools

Recommended initial interface:

```text
project.describe()
capabilities.list()
diagnostics.status()
logs.search(service, runId, timeRange, level, limit, cursor)
operations.timeline(operationId)
tests.getResult(runId)
```

These are proposed tools, not existing endpoints. Use validated structured filters and project/environment authorization. Return source coverage, bounds, ingestion status, and omissions alongside evidence. A missing event is inconclusive if collection is incomplete.

Logs and test output are untrusted data, not instructions for the agent. Keep secrets out of results. The MCP diagnostic surface is read-only and must not expose shell execution, unrestricted SQL, deployment mutation, or host Docker control. Read-only claims require real permission enforcement; tool names/descriptions alone are insufficient.

Generation or test-execution MCP tools can be a separate later permission surface using the same planner/harness. Do not give a log-query tool indirect authority to run a test that mutates production data.

### 19.4 E2E evidence

Use isolated run identities, fixture accounts/data, configuration fingerprints without secrets, and real application assertions. Test clients assert HTTP outcomes, persisted state, realtime events, job terminal state, and captured email/provider results as appropriate.

Correlated logs help explain failures; they do not replace assertions. Distinguish fake-port behavior, local real infrastructure, external provider acceptance, recipient/device observation, and deployed behavior. A log saying “sent” is not proof of delivery.

Retain assertions, relevant sanitized logs, trace/operation context, client artifacts, and environment/source coverage. Wait for the application outcome separately from bounded diagnostic flushing. A timeout or lost response may require resolving the original operation rather than retrying a new one.

## 20. Generated agent instructions and documentation

Generate a concise `AGENTS.md`, human `README.md`, architecture reference, selected capability guides, canonical feature examples, and exact available scripts. Agent-specific entry files for Codex, Claude Code, Grok Build, or other tools must follow verified tool support rather than assumed universal filename/precedence behavior.

Maintain one versioned policy source and thin bridges. Avoid long duplicated rulebooks or mandatory symlinks. Feature-specific guidance appears only for selected capabilities. Developer additions remain in clearly owned content; updating generated sections must detect conflicting edits rather than erase them.

Core agent guidance should require:

- Read project selections and the affected owner rules.
- Use the project-local pinned CLI for supported scaffolding.
- Follow owner/public boundaries, pure domain/application rules, one class per file, and explicit mapping/composition.
- Reuse installed identity, persistence, realtime, mail, and storage capabilities.
- Inspect existing code before editing; never regenerate over customization blindly.
- If no generator supports the operation, follow the architecture manually and report the extension gap.
- Run checks appropriate to the change and update affected public contracts/docs.
- Distinguish what was generated, checked, actually run, externally verified, or deployed.

Enforce measurable rules through typechecking, lint, dependency-boundary checks, generator contracts, and selected CI gates. Check layer paths and responsibilities, not only `.service.ts` suffixes. Generated/vendor files need appropriate exceptions.

Markdown and lint cannot prove SOLID, business ownership, authorization correctness, or guaranteed agent compliance. Keep review obligations explicit. Do not copy personal machine policies, account-specific exceptions, or obsolete project rules into every generated app.

## 21. Verification and acceptance criteria

### 21.1 Evidence layers

| Layer | Establishes | Does not establish |
| --- | --- | --- |
| Template/static checks | Valid output shape, compilation, measured architecture constraints. | Runtime/provider behavior. |
| Unit/contract tests | Specified policy and adapter contract under test conditions. | Real DB atomicity or provider delivery when fakes are used. |
| Local integration | Real selected database/service behavior in an isolated setup. | Production operation or every external provider. |
| Provider acceptance | Actual configured provider behavior for the exercised flow. | Every client platform or recipient observation. |
| Multi-instance acceptance | Exercised cross-instance routing, authority, failure, and recovery. | Unmeasured capacity or all deployment topologies. |
| Deployment acceptance | Identified release/services ready and relevant interactions exercised. | Unrun restore, security, or native-device scenarios. |

VCLI release CI should create, install, typecheck/lint, build, boot, and exercise supported representative generated applications. Ordinary developer checks remain proportional to changes; documentation edits do not require application builds by default.

Test each recipe's relevant contracts, each database implementation, dependency combinations, and critical security/reliability interactions. Use selected interaction coverage for other combinations rather than claiming an unbounded exhaustive matrix. Publish supported versions/combinations and reject others explicitly.

### 21.2 Representative acceptance register

| ID | Scenario | Required outcome |
| --- | --- | --- |
| ACC-01 | Initialize supported Firebase/Mongo project. | Installs/builds/boots after declared setup; auth/session interaction succeeds. |
| ACC-02 | Initialize supported local-auth/PostgreSQL project. | Complete registration/login/refresh/reset behavior with real DB and declared mail evidence. |
| ACC-03 | Add a capability after application customization. | Complete wiring; unrelated source/custom edits preserved. |
| ACC-04 | Repeat the same addition. | No duplicate source/config/docs/providers; damaged/partial state is reported. |
| ACC-05 | Dry run and stale saved plan, including a newly occupied planned path. | Dry run makes no project/external changes; existence/content preconditions prevent overwrite. |
| ACC-06 | Interrupt generation or fail dependency install. | Accurate partial status and safe recovery/retry. |
| ACC-07 | Extend with a new provider. | Adapter/recipe/tests suffice; existing business consumers remain unchanged. |
| ACC-08 | Firebase ID-token rotation, concurrent bootstrap, and enrollment after revocation. | Stable session; consistent ownership; old proof cannot bypass revocation by enrolling a replacement, while genuine reauthentication follows the declared policy. |
| ACC-09 | Firebase phone-only identity or unconfigured provider. | No fabricated email; enabled supported identity works; external setup failure is clear. |
| ACC-10 | Invalid/expired JWT or wrong issuer/audience/algorithm/key. | Safe rejection under the documented policy. |
| ACC-11 | Concurrent refresh, lost refresh response, consumed-token reuse. | Explicit retry/reuse policy holds without uncontrolled sessions or accidental replacement-login revocation. |
| ACC-12 | Expired/replayed/concurrently consumed reset token. | Only the permitted state transition succeeds. |
| ACC-13 | Current/selected/others/all logout and idle sockets. | Exactly the intended authority ends within the declared bounds, including multi-instance profiles. |
| ACC-14 | Old async cleanup after account switch/rebind. | New session/destination survives; no disclosure to replacement owner. |
| ACC-15 | Unauthorized room/channel/event or forged actor. | Backend-derived authority prevents cross-account disclosure/mutation. |
| ACC-16 | Socket.IO, ws, and Centrifugo client interaction. | Each documented client protocol works; unsupported protocol features fail clearly. |
| ACC-17 | Realtime service interruption and reconnect. | Documented recovery; no false durable-delivery promise. |
| ACC-18 | Push token rotation during an old failed send. | New token retained; invalid old destination cleaned safely. |
| ACC-19 | SMTP/provider rejection or uncertain outcome. | Typed result/retry behavior; queueing is not reported as delivery. |
| ACC-20 | Local/S3 upload, unauthorized access, and grant replay. | Ownership, bounds, integrity, and private access verified; late uploads cannot alter finalized bytes; issued grants honor their declared expiry/revocation bounds. |
| ACC-21 | S3-compatible preset with unsupported operation. | Verified alternate behavior or explicit unsupported result; no silent loss of integrity. |
| ACC-22 | Mongo versus PostgreSQL behavior contracts. | Equivalent advertised invariants using appropriate constraints and transactions. |
| ACC-23 | Each deployment target and stateful restart. | Required services/config/routes work; durable data survives ordinary redeployment. |
| ACC-24 | Backup/restore or migration failure. | Documented recovery exercised; no claim that image rollback reverses schema changes. |
| ACC-25 | E2E failure with diagnostics. | Assertions plus correlated bounded evidence; coverage/truncation visible. |
| ACC-26 | Collector/viewer restart or logs contain sentinel secrets/malicious text. | Gaps/truncation visible; no unbounded app buffering/business retries; sentinel values absent or redacted in retained artifacts, viewer, and MCP; text remains untrusted data. |
| ACC-27 | Diagnostic exposure, collector privileges, or MCP write/cross-scope attempts. | Private/authenticated access enforced; collector authority isolated; writes and a second project/environment rejected by actual permissions. |
| ACC-28 | Agent generates a feature and violates a measurable boundary. | Correct scaffolding succeeds; relevant check detects the violation. |
| ACC-29 | Upgrade customized project. | Explicit migration, accurate conflicts, preserved developer ownership, appropriate revalidation. |
| ACC-30 | Interrupted/uncertain deployment apply or stale platform state. | Accurate reconciliation and partial status; stale inputs rejected; retries do not duplicate resources or replace persistent data/credentials. |
| ACC-31 | Edit a stack choice without reconciliation, then generate source. | Generation reports drift and plans reconciliation; it does not mix an uninstalled provider into the realized application. |

Required assertions should test behavior, not simply that generated classes exist. A small reference app plus focused fixtures is preferable to relying only on a giant all-features app that can conceal undeclared dependencies.

## 22. Versioning, source ownership, and maintenance

Version the CLI, manifest schema, blueprint, capability recipes/contracts, provider adapters, and supported framework/toolchain combinations deliberately. Pin a compatible project-local CLI and package-manager lockfile so existing projects do not silently use the newest global generator.

Application code becomes developer-owned after generation. Managed metadata/docs/config sections have explicit ownership and conflict rules. Store enough nonsecret baseline/provenance information to propose upgrades; do not replay current templates over customized source.

Recommend generated application composition and business source, with small runtime libraries only where a stable shared responsibility justifies centralized maintenance. VCLI itself is not a runtime dependency. Shared auth/security mechanics versus copied source remains an explicit decision.

Copied security-sensitive code does not receive fixes merely because VCLI is upgraded. Maintain advisories, version detection, patch/migration guidance, and reviewed upgrade paths. Runtime libraries likewise require version compatibility, release notes, and regression evidence.

Do not remove installed features or data by editing a selection alone. Future removal/switch commands must analyze consumers, retained data, credentials, and migrations. Support deprecation windows and actionable unsupported-version diagnostics.

## 23. Suggested delivery plan

All requested capability families remain in target scope. This sequence is recommended and is not an estimate or a committed release schedule.

| Stage | Deliverables | Gate |
| --- | --- | --- |
| A — Design baseline | Reviewed requirements, canonical feature, extension/manifest contracts, ownership, support/evidence model, key decisions. | Engineers can explain expected output and challenge every unresolved choice. |
| B — Engine vertical slice | Init, project config, one database/auth path, generate feature, incremental realtime addition, dry-run/conflicts/idempotence, basic doctor/check/docs. | ACC-03–07 and representative app build/boot/interaction. |
| C — Real variation | Second auth and database implementation; exercise all four Firebase/local × Mongo/PostgreSQL boot/session combinations with shared contracts. | Auth/session/concurrency parity and no vendor leakage into use cases. |
| D — Realtime catalog | Complete Socket.IO, Centrifugo service recipe, native ws, explicit client protocols and selected scale-out behavior. | Provider-specific and cross-instance acceptance. |
| E — Mobile and service capabilities | SMTP/auth email, installations/destinations, FCM/APNs purpose variants, local/AWS/S3-compatible storage. | Provider/destination/ownership and storage acceptance. |
| F — Diagnostics and AI | Structured logging baseline extended with Vector, Logdy, retained evidence, read-only MCP, correlated E2E artifacts. | Diagnostic failure, privacy, access, and evidence acceptance. |
| G — Deployment catalog | Dokploy, Coolify, CapRover adapters, selected services, migration/state/restore workflows. | Separate live acceptance for each platform/profile. |
| H — Maintenance and extension | Reviewed upgrades, compatibility policy, stable internal extension API, optional external plugins/Schematics/MCP generation bridge. | Customized-project upgrades and independent new-provider exercise. |

Logging foundations, agent documentation, and verification start in stage B; later stages expand them rather than postponing quality until the end. Platform planning constraints should influence recipes before deployment implementation.

Extension interfaces are provisional and contract-tested from stages A–B. Stage H stabilizes their published compatibility policy after real variations have exercised them; it does not introduce extensibility for the first time.

Recommended first deployment reference is Dokploy, reflecting the existing workflow; the default platform has not been selected by the owner. Local auth and PostgreSQL must be exercised early enough to prove abstraction rather than added after provider-specific assumptions harden.

## 24. Open decision register and principal risks

| ID | Decision | Current recommendation / criteria |
| --- | --- | --- |
| DEC-01 | CLI engine and transformation tools | Standalone capability planner; compare staged custom transforms versus Schematics behind the same contract. |
| DEC-02 | PostgreSQL library and migrations | Select one after evaluating transactions, explicit mapping, generated-code readability, migrations, and maintenance. No ORM approved yet. |
| DEC-03 | Supported toolchain and host platforms | Pin tested Node/Nest/TypeScript/DB/package-manager versions; define macOS/Linux/Windows support explicitly. Existing source versions are evidence, not automatic defaults. |
| DEC-04 | Initial presets/default choices | API/mobile/realtime presets are proposed combinations. Auth/database/default enabled Firebase methods remain explicit choices. |
| DEC-05 | Local auth security policy | Hashing library/parameters, token lifetimes, refresh retry/reuse, credential transport, key rotation, and revocation bounds require review. |
| DEC-06 | SQL/Mongo identifier and pagination contract | Choose public identifiers and pagination semantics without leaking vendor representation. |
| DEC-07 | Centrifugo admission and engine profiles | Backend proxy recommended; direct grants and engine/scale-out profiles need defined guarantees. |
| DEC-08 | Frontend/client scope | Backend/services plus typed contracts and small executable clients recommended; full Flutter/React apps not yet authorized scope. |
| DEC-09 | Local service workflow | Offer Compose and existing services; decide default and supported service discovery/ownership rules. |
| DEC-10 | Deployment depth and first reference | Artifact generation plus explicit platform apply/verify; Dokploy-first proposed. Define supported provisioning and authentication mechanisms. |
| DEC-11 | Diagnostics retention/backend | Bounded JSONL for local tests recommended; choose production backends, retention, and MCP transport/permission enforcement. |
| DEC-12 | Generated versus shared runtime security code | Favor readable generated application code; identify narrow stable libraries and patch responsibility. |
| DEC-13 | API validation/response conventions | Select one baseline, explicit special-protocol exceptions, and provider-neutral error mapping. |
| DEC-14 | Initial named S3-compatible providers | Define supported operations and compatibility evidence; arbitrary endpoints do not imply blanket support. |
| DEC-15 | Optional tenancy, roles, jobs, scheduler, cache | Useful extension families; choose concrete scope without adding speculative business policy or mandatory infrastructure. |
| DEC-16 | Distribution, licensing, and package name | Public/private npm distribution, namespace availability, extracted-source licenses, plugin trust and release ownership need decisions. |
| DEC-17 | Multiple implementations in one app | One selection per singleton family initially; purpose-routed push and composed diagnostic roles remain supported. Other coexistence and provider/database switching need separate design. |
| DEC-18 | Resource/automation policy | Local machine limits and production mutation authority must be configurable and separate from universal generated coding rules. |

Principal risks and mitigations:

- **Combinatorial growth:** publish a bounded support matrix and shared contract tests; avoid claiming every permutation works.
- **Abstractions that hide behavior:** document capability guarantees and expose meaningful unsupported differences.
- **Too much framework code:** keep the planner and contracts small; split packages only when justified.
- **Generated-source drift:** explicit ownership, preconditions, provenance, and migrations.
- **Security fixes stranded in copied code:** advisory and upgrade responsibility from the first release.
- **False operational readiness:** separate generation, configuration, reachability, behavior, provider, and deployment evidence.
- **Credential/log disclosure:** schema-driven secret classification, bounded allowlisted output, scoped diagnostic authorization.
- **State loss during deployment:** platform-specific volume/migration handling, backups and exercised restore.
- **AI overconfidence:** checks and evidence metadata accompany instructions; business review remains necessary.
- **Legacy policy contamination:** curate the new blueprint; do not copy personal/product-specific rules or conflicting historical instructions wholesale.

## 25. Review response template and implementation gate

Suggested review item:

```text
Review ID:
Requirement/decision/section:
Category: correctness | security | extensibility | usability | operations | scope
Severity: blocking | important | suggestion
Observed issue or ambiguity:
Concrete failure/example:
Proposed change:
Alternatives and trade-offs:
Affected capabilities and compatibility:
Acceptance evidence required:
Owner decision needed:
```

Before implementation, reviewers should be able to answer:

1. Can a new provider be added without changing existing business consumers?
2. Are every requested provider family and deployment target still represented?
3. Are identity, sessions, installations, connections, and notification destinations distinguished?
4. Does each database preserve the promised invariants using its actual mechanisms?
5. Can the generator explain and safely apply an addition to customized source?
6. Are configuration, secret values, generated state, and runtime evidence distinct?
7. Do source ownership and upgrade/security-patch obligations have an accountable owner?
8. Do deployment plans account for persistent state and platform limitations?
9. Can an agent diagnose a failed test without gaining production mutation authority?
10. Are the open decisions resolved enough for the first vertical slice, with remaining decisions explicitly tracked?

Approval should identify accepted decisions, requested changes, and the authorized first implementation slice. This document does not imply a commit, push, package publication, new service account, infrastructure provisioning, or production deployment.

## 26. References and evidence boundary

Official references were reviewed during discovery on 14 November 2026. They support the specific distinctions above, not a claim that VCLI integrations have been implemented. Recheck relevant provider/platform versions before implementation.

| Ref | Primary source | Relevance |
| --- | --- | --- |
| S01 | [Firebase email action links](https://firebase.google.com/docs/auth/admin/email-action-links) | Firebase actions can be delivered through custom mail. |
| S02 | [Firebase phone authentication](https://firebase.google.com/docs/auth/web/phone-auth) and [Apple authentication](https://firebase.google.com/docs/auth/web/apple) | Provider/client and external setup requirements. |
| S03 | [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Password hashing design baseline; parameters/library still require review. |
| S04 | [Nest WebSocket adapters](https://docs.nestjs.com/websockets/adapter) | Socket.IO/ws differences and scale-out routing considerations. |
| S05 | [Centrifugo backend proxies](https://centrifugal.dev/docs/server/proxy) | Connection/refresh/subscription/publication integration choices. |
| S06 | [Vector repository](https://github.com/vectordotdev/vector) and [Docker log source](https://vector.dev/docs/reference/configuration/sources/docker_logs/) | Collector/transform/router role and source delivery limits. |
| S07 | [Logdy overview](https://logdy.dev/docs/what-is-logdy), [buffering](https://logdy.dev/docs/explanation/following-logs), [REST API](https://logdy.dev/docs/reference/rest-api), [LogdyPro](https://logdy.dev/logdy-pro) | Live viewing, bounded buffer, documented ingestion, separate retained-search product. |
| S08 | [Dokploy Docker Compose](https://docs.dokploy.com/docs/core/docker-compose) | Environment, service, volume, and deployment mechanics. |
| S09 | [Coolify build/deployment model](https://coolify.io/docs/core/build-deployment-model) | Build/image/Compose paths, readiness, and persistence. |
| S10 | [CapRover Compose support](https://caprover.com/docs/docker-compose) | Limited experimental Compose interpretation. |
| S11 | [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/) | Provider-specific S3 operation support. |
| S12 | [Nest CLI repository](https://github.com/nestjs/nest-cli) | Reference project; custom collection/generation behavior was also inspected in locally installed CLI/schematics source. |

Local source inspection established candidate mechanisms and gaps summarized in section 3. It did not run new VCLI builds/tests, provision providers, exercise platform deployments, or validate a new end-to-end integration. Hatem's current coding instructions informed section 4 and are embedded here so reviewers do not need private instruction files.

The next deliverable after review is a revised, decision-resolved specification and an explicitly scoped implementation plan. The purpose of this draft is to make those decisions concrete and reviewable.

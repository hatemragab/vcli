# Phase 00 — Design baseline and standalone setup

**Status: Planned — not completed by writing this plan.** This phase establishes the decisions and evidence needed for implementation. No implementation, download, provider registration or deployment is authorized merely by this document.

Read [START-HERE](../../START-HERE.md), [PRODUCT](../../docs/PRODUCT.md), [ARCHITECTURE](../../docs/ARCHITECTURE.md), [DECISIONS](../../docs/DECISIONS.md), [VERIFICATION](../../docs/VERIFICATION.md), then [TASKS](TASKS.md) and [ACCEPTANCE](ACCEPTANCE.md).

## Outcome

An engineer working in the new VCLI repository can explain the product, name the first supported stack, identify remaining decisions, and implement Phases 01–02 without relying on SuperUp or the chat. Resolve concrete choices needed now; do not design every future provider API or create an empty package hierarchy.

## Standalone repository and provenance

Confirm the destination contains this portable package and preserve existing destination files. Initialize source control, configure remotes or publish only within the owner's actual authorization. Decide package name/scope and public/private distribution without assuming registry availability.

The source of truth is this plan and newly verified source. If extraction from SuperUp/Whizpee is later authorized and available, inspect only relevant sanitized files. Classify reusable conventions, reusable implementation, product-specific logic, secrets, and third-party licensed material. Record provenance/license and needed adaptations. Copying a large auth guard or a product's short persistence field names is not required to preserve style.

No source checkout is required to start from the documented architecture. If an exact behavior is missing, mark it as a design decision, not as an inspected fact.

## Baseline decisions to record

Use the [decision register](../../docs/DECISIONS.md). The recommended direction is standalone TypeScript, ordinary Nest runtime, bounded generated registration files, a curated recipe registry, one package manager, one class per file, and small ports at real provider boundaries.

Record exact compatible versions for Node, Nest, TypeScript, package manager, test runner, validator, and build tooling needed by Phase 01. Select ESM/CommonJS and verify package exports, templates, source maps, asset copying, and local execution consistently. Later SDK versions can be recorded when their phase starts; do not hold Phase 01 for an APNs version selection.

For new validation use the recommended Zod baseline only after checking supported Nest/OpenAPI integration for the chosen versions. If a bridge or custom pipe is required, justify and test it instead of assuming all Nest versions provide the same feature. Preserve request validation and useful generated OpenAPI output.

Database baseline is Mongoose and Drizzle/pg with reviewed migrations; identifiers are UUIDv4 with explicit cursor sort fields. These are recommendations to confirm, not an instruction to install all database tools in Phase 00. If there is a material blocker, record the smallest justified alternative and update affected documents before source depends on it.

## Freeze one example contract

Define a small non-product demonstration owner such as `notes` with one create operation and one read/list operation. Record actor/authorization, input bounds, output, missing/forbidden errors, duplicate/idempotency policy where relevant, persistence ownership and visibility. A name alone must not cause a generator to invent public CRUD.

Approve naming, folder layout, API prefix, response/error envelope, validation behavior and OpenAPI conventions with this example. Streaming downloads, health endpoints and provider callbacks need their protocol-specific shapes; do not wrap every response indiscriminately. Keep domain code pure and avoid empty layers for a trivial owner.

Use the sample to specify what each generator can safely produce and what still needs developer logic. It becomes the reference fixture for Phase 02 and database parity later.

## Check extension and deployment feasibility early

Walk through adding capture mail, then SMTP/HTTP mail behind the same consumer contract. The registry should resolve capabilities without a marketplace or dynamic third-party code loading. Decide generated/scaffold ownership, required option/default behavior, and how explicit Nest imports expose capability providers to consumers.

Draft an artifact-level service example containing API, database, a realtime endpoint and release migration command for Dokploy, Coolify and CapRover. Consult current official docs for supported keys, ingress, env injection, persistence and replacement behavior. Record a feasible native profile for each; CapRover need not accept an arbitrary Compose graph. This is a paper/artifact feasibility check, not permission to provision infrastructure or claim deployment acceptance.

Similarly record the first AWS/S3-compatible candidate and operations needing verification: conditional writes, multipart completion, checksum/version binding and serving. Do not specify universal storage capability levels or require every provider operation before one consumer exists.

## Resources and policy

Record available contributor OS/tool caches, disk/memory constraints, provider sandbox credentials, native device access and authorized deployment hosts without storing secret values. Missing resources become explicit setup requirements. Honor the current host's limits; do not copy VPS or Mac-specific paths into templates.

Assign maintenance ownership for the CLI and narrow authentication package. Local auth requires a threat model and measured policy in Phase 03; identify that gate now. Decide where sanitized test evidence will be stored and how statuses distinguish local from provider/device/deployment acceptance.

## Deliverables and handoff

Update active shared documents rather than create a competing specification. Record accepted decisions, exact initial toolchain, canonical example contract, provenance policy, supported host profile, target feasibility notes and remaining external setup. All later phase tasks remain unchecked until implemented.

Phase 00 exits when Phase 01's necessary decisions are resolved and other decision deadlines are explicit. It does not require every future optional feature to be approved or every account to be provisioned. The next action is the authorized [Phase 01](../01-project-foundation/README.md) implementation scope.

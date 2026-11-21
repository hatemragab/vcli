# Reference application rules

This is a hand-built expected-output application for owner review. Do not implement VCLI, mark generator phases complete, publish or deploy it.

## Current authorized design

The owner replaced the earlier layered design with compact NestJS modules. Use flat feature directories with entity, service and module files, adding controllers, DTOs and focused implementation services only when needed. No mandatory domain/application/adapters/ports/public directories, redundant wrapper layers or compatibility barrels. Data services inherit genuinely reused operations from shared base repositories; feature-specific methods stay in their service. Keep types strong and related schemas/types cohesive. One handwritten class per file, kebab-case filenames, single quotes and the existing formatter apply.

Shared database CRUD, pagination, explicit transactions, validated configuration, HTTP validation/error handling and authentication belong under src/core. Infrastructure choices use ordinary Nest injection/provider registration. Keep provider implementations flat and consumer-facing services small. This standalone reference is fixed to postgres. It must contain only that database implementation, schemas, direct dependencies, configuration and operational artifacts. No runtime database selector, Database union, RepositoryAdapter/dual-driver definition, or application memory database. Native query/session types are allowed in feature services. Tests may use private test doubles, never a selectable application database. VCLI remains unimplemented.

Circular dependencies are prohibited, including file imports, type imports and feature-module dependencies. Never use forwardRef, ModuleRef/service-locator lookups, lazy imports or @Global to conceal a cycle. Core must never import features. Move neutral types to core or put multi-feature orchestration above its dependencies. Do not move feature-specific behavior into core just to silence a cycle check. Use deliberate exported services across modules; do not import another module's raw models.

Preserve current authorization, ownership, rate limits, atomic refresh/action-token transitions, credential-version checks, storage immutability, push generation fencing, safe errors, secret redaction and cleanup. Pass the same explicit transaction/session to all participants; keep external effects outside retryable transactions. Generic CRUD is an internal service capability, never an automatically exposed unrestricted HTTP API.

## Shared logging

Use the explicitly imported `LoggingModule` and its `AppLoggerService`/`DIAGNOSTIC_EVENTS` provider for application events. Root composition owns the bounded retained writer and logger lifecycle before database setup and after feature shutdown. Preserve the shared allowlisted event schema, safe errors, async UUID correlation, and independent failure handling; raw messages, errors, payloads, URLs, credentials and environment values do not belong in diagnostics. Vector consumes sanitized retained JSONL for the private Logdy live feed; the reader/MCP query retained files independently. Add event/field contracts and Vector normalization together, with focused redaction and correlation checks. See `docs/operations.md` for actual evidence and setup limits.

## Verification and collaboration

Follow parent host/resource rules. No worktrees, downloads above 500 MB without authorization, provider provisioning, production migrations, deployment or emulators. Reuse pinned installed packages. No worker installs, services, global formatting, shared builds or root edits unless coordinator explicitly delegates them. Coordinator owns final static/build/HTTP/protocol/browser checks and real local service acceptance. Fake/local/provider/device/deployed evidence remain separate.

See ../NATIVE-DATABASE-CONTRACT.md for current native-database task ownership. External and unfinished capabilities stay explicit. Do not claim earlier baseline evidence verifies changed source.

## Current repository expansion task

Follow ../NATIVE-DATABASE-CONTRACT.md. Expand useful native BaseRepository methods while preserving authorization and atomic workflows. Coordinator owns package lock installation and final real-service verification. The other reference project has separate ownership; never import its code or edit its files. The source/dependency-isolation checker files and their tests are owned by the isolation worker.

# Reference application architecture

This is the existing hand-built expected-output reference. VCLI remains unimplemented. The owner approved compact NestJS modules after reviewing the first layered version.

## How to read a feature

Start with modules/notes: notes.entity.ts defines the data/schema and validation, notes.service.ts inherits shared BaseRepository CRUD and adds owner-scoped operations, notes.module.ts registers/exports the service, and notes.controller.ts handles HTTP validation and verified identity. There are four files, with no mandatory internal folders. Accounts has the same pattern; installations needs no HTTP controller. Complex identity/protocol workflows keep focused helper services rather than merging unrelated responsibilities.

Data services inherit native PostgreSQL CRUD, conditional writes, explicit conflict-target upserts, bounded pagination/iteration and typed SQL extensions. Read the [repository contract](base-repository.md) for the complete signatures and guarantees. Conditions use Drizzle SQL and owner-defined tables/columns. Projection options return `Pick<T,K>`, summaries report affected rows, nullable reads differ from OrThrow, and stable ordering appends a unique ID. Existing transactions are reused; omitted contexts start one. External effects stay outside retry callbacks.

## Shared mechanisms

| Location                                   | Responsibility                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| core/config                                | Conditional typed environment validation and deliberate file loading                                           |
| core/database                              | Shared base CRUD, native PostgreSQL implementation, pagination types and explicit transaction coordination     |
| core/auth                                  | Verified principal and narrowly shared authentication facts/contracts                                          |
| core/http                                  | Guards/current principal, request validation, safe errors, OpenAPI and redacted request facts                  |
| core/logging                               | Shared Pino application logger, approved event schema, asynchronous correlation and explicit Nest registration |
| core/errors                                | Application error codes                                                                                        |
| core/diagnostics, core/mail, core/realtime | Small contracts shared by actual consumers                                                                     |
| modules/mail, storage, push                | Directly injectable MailService, StorageService and PushService                                                |
| modules/realtime, diagnostics              | Directly injectable RealtimeService and DiagnosticsService, with focused protocol/reader services              |

Mail/storage/realtime implementations use ordinary Nest registration and exports. No consumer needs provider conditionals. Media/push repositories retain specialized atomic quotas, ownership and generation transitions; replacing these with generic CRUD would weaken their guarantees. Stored media retains the provider used for that object. Changing the default does not migrate data.

## Dependency rules

File imports include runtime, type-only imports, re-exports and import types. They and the feature dependency graph must be acyclic. Core imports no feature; neutral contracts belong in core, while schema setup and multi-feature orchestration live above participants. Features expose services through their Nest module. No forwardRef, ModuleRef, LazyModuleLoader, @Global, require or dynamic import escapes are allowed. The architecture check also enforces flat feature directories and one handwritten class per file.

Run `make check-architecture` or `npm run check:architecture`. `npm run build` and `npm run check` run it automatically. Regression fixtures deliberately introduce type/barrel cycles, feature-only cycles, core back-edges and hidden-loading shortcuts and assert rejection. This checks the application source; it is not a claim that third-party dependency internals are cycle-free or that every future runtime configuration is verified.

## Request and startup flow

POST /api/notes -> PrincipalGuard -> NotesController -> NotesService.createOwned -> inherited create -> selected repository/database -> advisory realtime publication -> saved note and publication outcome. Clients recover authoritative state through HTTP reads; there is no durable outbox or event replay.

main.ts loads validated configuration and starts the process. create-reference-app.ts composes the selected feature modules and owns cleanup. It closes HTTP/realtime before database resources; listener failures also close initialized resources. app.custom.module.ts remains the developer integration seam. generated/vcli-app.module.ts is a hand-built illustration of future tool-owned registration, not generated provenance.

## Shared logging and retained evidence

`create-reference-app.ts` opens the existing bounded diagnostics writer before initializing database/provider resources and composes one `AppLoggerService`. It passes that instance to Nest and HTTP/realtime instrumentation and registers it through explicit `LoggingModule` imports/exports. Application code emits typed allowlisted event facts through that service or the small `DiagnosticEvents` capability. Per-instance `AsyncLocalStorage` preserves validated request/operation/run correlation across asynchronous application work. Arbitrary messages, stacks, credentials, request bodies and raw provider data are omitted before every destination; Nest framework calls preserve a fixed event and severity only.

Pino JSON stdout and the retained writer receive the same sanitized event facts. The retained writer adds local writer/sequence identity and keeps its existing bounded queue/rotation/failure behavior. Its lifetime belongs to the application root, so startup/provider failures and shutdown observations can be retained independently of realtime. Invalid configuration before a safe writer can be opened is stdout-only. `DiagnosticsModule` owns only retention/query/MCP services; it does not supply a competing logger alias.

The application-only diagnostics flow is `AppLoggerService -> bounded rotated JSONL -> Vector -> Logdy`, with the offline reader/MCP querying the same local JSONL independently. Vector revalidates schema/scope and preserves approved HTTP/correlation/numeric fields while discarding extra content. Collector/viewer outages cannot stop business work or offline evidence reading. The separate logging task passed a real native loopback feed and retained-reader availability after viewer termination; see [verification](VERIFICATION.md) for that scoped evidence. Container networking/permissions, viewer browser rendering, reconnect/overload, database/worker/infrastructure sources, remote access and stronger isolation remain pending. HTTP mutation terminal events identify the HTTP outcome and do not establish external delivery or replace test assertions.

## Authentication and persistence

Local auth retains real Argon2id/JOSE, short access tokens with current-session checks, strictly single-use refresh rotation, and one-use email confirmation requiring the proof holder's password. Confirmation atomically changes credentials, advances version and revokes obsolete sessions. Firebase clients sign in with selected password/phone/Google/Apple methods; the backend verifies their ID token plus an independently revocable app-session secret rather than issuing a second JWT pair.

This independent project contains PostgreSQL/Drizzle + pg only. `DATABASE_URL` is required and `DATABASE_DRIVER` is rejected. Account/identity/installations/sessions, media, push and notes persist exclusively to their owner-controlled PostgreSQL tables. The four schema release owners preserve repeated setup; the rate bucket column is `window_id`. No Mongoose schemas, second driver, portable adapter or application memory store is present.

Read [the actual file tree](PROJECT-TREE.md), [identity](identity.md), [storage](storage.md), [delivery](delivery.md), [realtime](realtime.md), [operations](operations.md) and [verification](VERIFICATION.md). External-provider/device/deployment and unfinished advanced-mode limits remain explicit.

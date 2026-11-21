# Functional owned notes example

`example.notes` is the explicit `notes` recipe, with empty options and required `foundation`, `database` and `auth` families. Realtime is optional. This is the frozen functional example from [the baseline](CLI-BASELINE.md), separate from unfinished name-only scaffolds. The recipe, CLI registration, API preset and configured consumer seam are implemented. Packed local/Firebase x both-database journeys and prepared real native owner checks passed; exact evidence and external limits are in [CLI verification](CLI-VERIFICATION.md). Historical reference evidence is not generated notes evidence.

## Integration contract

`notesFiles(config): Promise<RenderedFile[]>` is exported from `src/recipes/render-notes.ts`. It returns an empty array without the selection and rejects unknown notes options or absent prerequisites. Every emitted notes file is developer-owned scaffold source:

- Common: `src/modules/notes/notes.controller.ts`, `notes-input.ts`, `notes-result.ts`, `notes-authority.ts` and the feature `README.md`.
- Selected MongoDB or PostgreSQL: `src/modules/notes/notes.entity.ts`, `notes.service.ts`, `notes.module.ts` and `initialize-notes.ts`.
- Client: `clients/notes-client.mjs`.
- Without realtime: the existing neutral `src/core/realtime/event-publisher.ts`. With realtime, that recipe supplies the file, avoiding a duplicate path. No transport service or client is invented.

There are no new environment fields, dependencies, external assets or SQL files. The selected native SDK and existing Nest/Swagger/Zod dependencies suffice. Only one native implementation is emitted; the installed generator carries both template variants.

`createNotesRuntime(config, database, authority, publisher?)` is exported from the selected `src/modules/notes/notes.module.ts`. Its arguments are `AppConfig`, the caller-owned selected `MongoDatabase` or `PostgresDatabase`, neutral `PrincipalAuthority` and optional `EventPublisher`. It validates schema availability and returns `{ module }`; it never opens/closes a database, starts a worker, initializes schema or owns a shutdown step. Configure realtime first when selected and pass its publisher. The ordinary `NotesModule.register(authority, service)` imports configured `HttpSecurityModule`, provides `NotesService` and exports that service. A consumer must explicitly import the named configured notes module handle; root sibling imports provide no implicit visibility.

Coordinator integration: register `example.notes` under family `notes` requiring foundation/database/auth; add `--notes`, select it in the API preset, keep minimal empty, invoke `notesFiles`, compose `createNotesRuntime` with the already selected database/authority and optional realtime publisher, add its module to generated imports and `ConfiguredCapabilities.notes`, and update selected docs/OpenAPI guidance. The notes worker does not edit CLI/catalog/config/package/project composition. `render-scaffold.ts` reserves `notes` and maps `uses:['notes']` to injectable `NotesService` and an explicit configured consumer import.

## Persistence and release

Both variants inherit their selected native `BaseRepository<Note>`. Their sole namespace is `app_notes`, with UUIDv4 IDs, UUID owner IDs, bounded title/body and safe integer epoch-millisecond timestamps. MongoDB validates string primary-key equality, applies a collection validator and indexes `{ownerId:1,createdAt:-1,_id:-1}`. PostgreSQL creates a UUID-keyed table with text/time checks and `(owner_id,created_at DESC,id DESC)` index. There is no foreign-feature schema import or account-delete cascade. Reference collections/tables are never adopted or migrated.

`initializeNotes(database): Promise<void>` is the explicit owner initializer in each variant. MongoDB creates/configures the collection and index. PostgreSQL uses the caller's native transaction context and a transaction-scoped advisory lock for preserving `CREATE ... IF NOT EXISTS` DDL. Initialization is not application boot behavior. The selected `assertNotesInitialized(database)` performs a read-only availability check; the root release ledger provides overall release readiness.

The finite `render-schema.ts` contribution adds component `notes`, version 1, only when selected. Its logical digest includes the selected `initialize-notes.ts` and `notes.entity.ts`; no unselected import is emitted. The initializer callback opens the selected database with `openDatabase(config,false)`, awaits `initializeNotes(database)` and closes that callback-owned connection in `finally`. Existing owners, versions, digests and realtime component IDs remain unchanged. Manifest and callback order agree, including full selected profiles.

## HTTP and service behavior

All routes require the existing verified principal guard. The application retains its `/api` prefix:

| Route                     | Contract                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/notes`         | Strict JSON `{title, body?}`. Trim title, require 1–120 units; body defaults to `''` and is bounded to 10000 units. Server supplies UUIDv4, time and operation correlation outside retry callbacks. Success is HTTP 201 `{note, notification}`. |
| `GET /api/notes?limit=20` | Only `limit` is allowed, a decimal integer from 1 to 100, default 20. Return `{items,truncated}` ordered by `createdAt DESC`, then `id DESC`; read at most `limit+1` records.                                                                   |
| `GET /api/notes/:id`      | UUIDv4 note ID; owner-scoped lookup. Missing and foreign records return identical HTTP 404 `NOTE_NOT_FOUND`.                                                                                                                                    |

String limits preserve the reviewed reference's UTF-16 code-unit bounds; Unicode is preserved without normalization or truncation. This is explicit because the pinned Zod's ordinary string length checks count code points. Both HTTP validation and owner service validation apply the reference bounds. Hostile HTML/SQL-looking text remains literal JSON data, never markup or interpolated SQL. Owner, filter, ID, timestamp and native model input are rejected at the HTTP boundary.

`NotesService.createOwned(principal, draft, eventId)`, `listOwned(principal, limit=20)` and `getOwned(principal, id)` are the deliberate owner operations. The service derives ownership from the principal and explicitly maps the five public note fields. Returned records share no persistent object references. Native repository methods remain internal application capabilities; they are not generic HTTP CRUD.

Each operation rechecks `PrincipalAuthority.current(sessionId)` before database work and compares account, session, installation, installation generation and expiry. A denied or rebound principal cannot start that operation. This bounds authority use to one already admitted operation per request: revocation can race with that operation's database I/O or response, and cannot recall it. There is no strong revocation, global request-count or wall-clock cancellation guarantee, cached cross-request lease, or queued notes mutation.

Creation awaits native persistence/commit before exactly one advisory publish call, outside every database retry callback. Hints contain `notes.created` plus only `{noteId}` and trusted account audience. Notification statuses are the existing typed `attempted`, `provider-accepted`, `audience-ineligible`, `unavailable` and `unknown`; selected transports are copied only from the existing neutral contract. Without a publisher return `{status:'unavailable'}`. A thrown/malformed provider result becomes `{status:'unknown'}` because provider acceptance may already have occurred. None of these advisory outcomes rolls back or changes the successful saved-note response. A failed/ambiguous database write causes no publication and remains an error.

The API has no durable recipient delivery, event log, replay or HTTP idempotency promise. A failed/lost POST response may follow a committed write; callers must reconcile state rather than automatically retry POST. `X-Operation-Id` is correlation, not an idempotency key. Recover state through owner REST reads after realtime admission/reconnect and any hint.

## Client

Import `createNotesClient` from `clients/notes-client.mjs`, supply the API origin as `baseUrl` and an async `accessToken` getter. For local auth, that getter returns the current local access token; for Firebase it returns a fresh Firebase ID token and `sessionSecret` returns the existing enrollment capability. The caller owns credential storage/refresh. No credentials enter generated files or command arguments.

```js
const notes = createNotesClient({ baseUrl: apiOrigin, accessToken });
const saved = await notes.create({ title: 'Remember', body: 'Private text' });
const page = await notes.list(20);
const record = await notes.get(saved.note.id);
```

The client performs one request per operation and never retries creation implicitly. It treats notification uncertainty as advisory and does not invent a second auth protocol or transport.

## Verification and limits

All fixture emissions are restricted to ignored `var/cli-notes/`. Fixtures reuse installed native SDKs through read-only links to their existing cache locations; product output has no example imports or contributor paths. The loopback Nest server binds `127.0.0.1` on an ephemeral port and closes in `finally`. It uses real Nest DI/guard/controller dispatch, synthetic authority and controlled test persistence/provider results; this does not establish durable database or provider delivery evidence.

Focused commands run on 17 November 2026:

- `node --test --test-concurrency=1 test/notes-example-rendering.test.ts test/notes-example-runtime.test.ts`: 12 passed after correcting the test-only MongoDB native collection generic and explicit reference Unicode bounds. Includes both selected native strict compilations, architecture/import checks, deterministic closure, full schema callback ordering, preserved existing digests, explicit consumer scaffold mapping, authority generation/expiry negatives, safe response mapping, hint-after-write behavior and loopback HTTP/client checks.
- `node --test --test-concurrency=1 test/notes-example-native.test.ts`: two explicit skips because root-owned URLs were absent. No database was provisioned, migrated or contacted by that run.
- Scoped TypeScript `--noEmit`, ESLint and Prettier checks passed for the changed recipe renderers, notes tests, both emitted notes source sets, templates, client and this document. The static commands are recorded below.

Opt-in native fixtures use `VCLI_NOTES_MONGODB_TEST_URL` / `VCLI_NOTES_POSTGRES_TEST_URL`, or `TEST_DATABASE_URL` with `VCLI_NOTES_TEST_DATABASE=mongodb|postgres`. The operator must release the selected `app_notes` schema first in an isolated disposable database. These tests never provision/migrate and clean only their random owner rows. They exercise actual native constraints, ownership/missing/foreign 404 equivalence, stable ties and bounds, Unicode/hostile text, mutation isolation, reopen persistence, saved-before-unavailable/throwing/unknown hints and loopback HTTP with synthetic auth/provider. The coordinator subsequently configured and ran both native profiles; those results are recorded separately from the original worker skips.

The coordinator subsequently passed packed generation/install/build, HTTP/auth/Socket.IO/media and both native persistence gates. Real Firebase/provider/device/deployed evidence remains separate and pending. No install, shared build/dist output, external provider call, service/container/browser start, commit or publication is part of this worker slice.

Exact static commands (all exit 0):

```sh
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --allowImportingTsExtensions --strict --noUncheckedIndexedAccess --esModuleInterop --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node src/recipes/render-notes.ts src/recipes/render-schema.ts src/recipes/render-scaffold.ts test/notes-example-fixture.ts test/notes-example-rendering.test.ts test/notes-example-runtime.test.ts test/notes-example-native.test.ts
node node_modules/eslint/bin/eslint.js src/recipes/render-notes.ts src/recipes/render-schema.ts src/recipes/render-scaffold.ts test/notes-example*.ts
node node_modules/eslint/bin/eslint.js var/cli-notes/mongodb/src/modules/notes var/cli-notes/postgres/src/modules/notes
node node_modules/prettier/bin/prettier.cjs --check src/recipes/render-notes.ts src/recipes/render-schema.ts src/recipes/render-scaffold.ts test/notes-example*.ts templates/runtime/common/src/modules/notes templates/runtime/mongodb/src/modules/notes templates/runtime/postgres/src/modules/notes templates/runtime/common/clients/notes-client.mjs docs/CLI-NOTES.md
```

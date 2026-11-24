# Functional owned notes example

`example.notes` is the explicit `notes` recipe, with empty options and required `foundation`, `database` and `auth` families. Select full local auth or Firebase for its session-scoped ownership checks. Realtime is optional. Packed full-local/Firebase journeys on both databases and prepared real native owner checks passed. [Verification](CLI-VERIFICATION.md)

## Integration contract

`notesFiles(config): Promise<RenderedFile[]>` is exported from `src/recipes/render-notes.ts`. It returns an empty array without the selection and rejects unknown notes options or absent prerequisites. Every emitted notes file is developer-owned scaffold source:

- Common: `src/modules/notes/notes.controller.ts`, `notes-input.ts`, `notes-result.ts`, `notes-authority.ts` and the feature `README.md`.
- Selected MongoDB or PostgreSQL: `src/modules/notes/notes.entity.ts`, `notes.service.ts`, `notes.module.ts` and `initialize-notes.ts`.
- Client: `clients/notes-client.mjs`.
- With private Media: `notes-image.ts` and the selected native `initialize-notes-image.ts`. The module imports `MediaModule` and uses its exported `MediaService`.
- Without realtime: the existing neutral `src/core/realtime/event-publisher.ts`. With realtime, that recipe supplies the file, avoiding a duplicate path. No transport service or client is invented.

There are no new environment fields, dependencies, external assets or SQL files. The selected native SDK and existing Nest/Swagger/Zod dependencies suffice. Only one native implementation is emitted; the installed generator carries both template variants.

`createNotesRuntime(config, database, authority, publisher?)` is exported from the selected `src/modules/notes/notes.module.ts`. Its arguments are `AppConfig`, the caller-owned selected `MongoDatabase` or `PostgresDatabase`, neutral `PrincipalAuthority` and optional `EventPublisher`. It checks schema availability and returns `{ bindings }` for application bootstrap. The caller owns the database connection and supplies the selected realtime publisher when available. `NotesModule` imports `HttpSecurityModule` and exports `NotesService`. A consumer imports `NotesModule` in its own module to inject `NotesService`.

Select Notes with `--notes` or the `api` preset with full local auth or Firebase. The generator invokes `notesFiles`, composes `createNotesRuntime` with the selected database, authority and optional realtime publisher, and adds `NotesModule` to the imports of `VcliAppModule`. `render-scaffold.ts` reserves `notes` and maps `--use notes` to an explicit `NotesModule` import and an injected `NotesService`.

## Persistence and release

Both variants inherit their selected native `BaseRepository<Note>`. Their sole namespace is `app_notes`, with UUIDv4 IDs, UUID owner IDs, bounded title/body and safe integer epoch-millisecond timestamps. MongoDB validates string primary-key equality, applies a collection validator and indexes `{ownerId:1,createdAt:-1,_id:-1}`. PostgreSQL creates a UUID-keyed table with text/time checks and `(owner_id,created_at DESC,id DESC)` index. There is no foreign-feature schema import or account-delete cascade. Reference collections/tables are never adopted or migrated.

`initializeNotes(database): Promise<void>` is the explicit owner initializer in each variant. MongoDB creates/configures the collection and index. PostgreSQL uses the caller's native transaction context and a transaction-scoped advisory lock for preserving `CREATE ... IF NOT EXISTS` DDL. Initialization is not application boot behavior. The selected `assertNotesInitialized(database)` performs a read-only availability check; the root release ledger provides overall release readiness.

The `render-schema.ts` contribution adds component `notes`, version 1, only when selected. Its digest includes the selected `initialize-notes.ts` and baseline `notes.entity.ts`. When Notes and private Media are both selected, the release applies `notes.image` version 1 after the baseline Notes component. The MongoDB step extends its current collection validator with an optional `imageId`. The PostgreSQL step adds a nullable `image_id` column if missing. Existing Notes records and the baseline Notes digest are preserved. Each initializer opens and closes its own selected database connection.

## HTTP and service behavior

All routes require the existing verified principal guard. The application retains its `/api` prefix:

| Route                     | Contract                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/notes`         | Strict JSON `{title, body?}`. Trim title, require 1–120 units; body defaults to `''` and is bounded to 10000 units. Server supplies UUIDv4, time and operation correlation outside retry callbacks. Success is HTTP 201 `{note, notification}`. |
| `GET /api/notes?limit=20` | Only `limit` is allowed, a decimal integer from 1 to 100, default 20. Return `{items,truncated}` ordered by `createdAt DESC`, then `id DESC`; read at most `limit+1` records.                                                                   |
| `GET /api/notes/:id`      | UUIDv4 note ID; owner-scoped lookup. Missing and foreign records return identical HTTP 404 `NOTE_NOT_FOUND`.                                                                                                                                    |
| `PATCH /api/notes/:id`    | Strict JSON with at least one editable field. Omitted fields retain their values. Returns the updated note with HTTP 200.                                                                                                                       |
| `DELETE /api/notes/:id`   | Deletes the owned note and returns HTTP 204 with an empty body.                                                                                                                                                                                 |

String limits preserve the reviewed reference's UTF-16 code-unit bounds; Unicode is preserved without normalization or truncation. This is explicit because the pinned Zod's ordinary string length checks count code points. Both HTTP validation and owner service validation apply the reference bounds. Hostile HTML/SQL-looking text remains literal JSON data, never markup or interpolated SQL. Owner, filter, ID, timestamp and native model input are rejected at the HTTP boundary.

`NotesService` exposes `createOwned`, `listOwned`, `getOwned`, `editOwned`, and `removeOwned`. The service derives ownership from the verified principal and explicitly maps public note fields. PATCH and DELETE use an owner-scoped native write. Missing and foreign records return identical HTTP 404 `NOTE_NOT_FOUND` on read, edit, and delete. Returned records share no persistent object references.

When private Media is selected alongside Notes, POST and PATCH also accept `imageId` as an owned finalized upload UUID or `null`. The attachment checks the first bytes for a PNG, JPEG, GIF, or WebP signature through the Media service. Missing, unfinished, and foreign uploads return 404 `MEDIA_NOT_FOUND`, and unsupported signatures return 400 `INVALID_NOTE_IMAGE`. Notes without an image return `imageId: null` in this selection. Detach with `imageId: null`. Detaching, replacing an image, and deleting the note preserve the upload until removed through the Media API.

Select both capabilities at init with `--notes --media --storage local`, or add both while introducing Notes to an existing project. Previously generated Notes source is developer-owned. If you add Media to a project that already owns its Notes controllers and services, adapt those files explicitly to expose attachment support.

Each operation rechecks `PrincipalAuthority.current(sessionId)` before database work and compares account, session, installation, installation generation and expiry. A denied or rebound principal cannot start that operation. This bounds authority use to one already admitted operation per request: revocation can race with that operation's database I/O or response, and cannot recall it. There is no strong revocation, global request-count or wall-clock cancellation guarantee, cached cross-request lease, or queued notes mutation.

Creation awaits native persistence/commit before exactly one advisory publish call, outside every database retry callback. Hints contain `notes.created` plus only `{noteId}` and trusted account audience. Notification statuses are the existing typed `attempted`, `provider-accepted`, `audience-ineligible`, `unavailable` and `unknown`; selected transports are copied only from the existing neutral contract. Without a publisher return `{status:'unavailable'}`. A thrown/malformed provider result becomes `{status:'unknown'}` because provider acceptance may already have occurred. None of these advisory outcomes rolls back or changes the successful saved-note response. A failed/ambiguous database write causes no publication and remains an error.

The API has no durable recipient delivery, event log, replay or HTTP idempotency promise. A failed/lost POST response may follow a committed write; callers must reconcile state rather than automatically retry POST. `X-Operation-Id` is correlation, not an idempotency key. Recover state through owner REST reads after realtime admission/reconnect and any hint.

## Client

Import `createNotesClient` from `clients/notes-client.mjs`, supply the API origin as `baseUrl` and an async `accessToken` getter. For local auth, that getter returns the current local access token; for Firebase it returns a fresh Firebase ID token and `sessionSecret` returns the existing enrollment capability. The caller owns credential storage/refresh. No credentials enter generated files or command arguments.

```js
const notes = createNotesClient({ baseUrl: apiOrigin, accessToken });
const saved = await notes.create({ title: 'Remember', body: 'Private text' });
const edited = await notes.edit(saved.note.id, { title: 'Remember tomorrow' });
const page = await notes.list(20);
const record = await notes.get(edited.id);
await notes.remove(record.id);
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

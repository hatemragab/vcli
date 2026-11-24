# Owned notes example

The verified principal owns the note. The server supplies its ID and creation time. Titles are trimmed and accept 1–120 UTF-16 code units. The body accepts up to 10,000 UTF-16 code units and defaults to an empty string on create.

| Authenticated endpoint    | Result                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/notes`         | HTTP 201 with `{ note, notification }`                                                  |
| `GET /api/notes?limit=20` | Owned `{ items, truncated }` ordered by `createdAt DESC, id DESC`. Limit from 1 to 100. |
| `GET /api/notes/:id`      | HTTP 200 with the owned note                                                            |
| `PATCH /api/notes/:id`    | HTTP 200 with the updated note                                                          |
| `DELETE /api/notes/:id`   | HTTP 204 with an empty body                                                             |

Create requires `title` and accepts `body`. PATCH requires at least one editable field and preserves any omitted fields. Missing and foreign notes both return 404 `NOTE_NOT_FOUND`.

<!-- vcli:notes-media:start -->

### Attach an image

When creating or editing a note, pass an owned finalized upload's UUID as `imageId`. Follow the selected private Media API to reserve, upload, and finalize the file, then retrieve it from `GET /api/media/:id/content` with the same account. Notes recognizes PNG, JPEG, GIF, and WebP signatures by reading the file header. Missing, unfinished, and foreign uploads return 404 `MEDIA_NOT_FOUND`. An unsupported file signature returns 400 `INVALID_NOTE_IMAGE`.

Use `imageId: null` to detach the image. A note without an image, including an older text-only note, returns `imageId: null`. Removing or replacing a reference, or deleting the note, keeps the upload available to its owner under the media API's own lifecycle.

The selected release applies the `notes.image` schema change after the baseline Notes schema. It adds an optional field and preserves existing records.

<!-- vcli:notes-media:end -->

Apply the application's explicit selected schema release before startup. `initializeNotes(database)` creates the selected native `app_notes` schema and index. Boot checks their availability. `createNotesRuntime(config,database,authority,publisher?)` uses the caller-owned database and returns `{ bindings }` for application bootstrap. Custom consumers import `NotesModule` in their own module to inject `NotesService`. Owner persistence methods are internal application capabilities, never an unrestricted HTTP filter API.

Creation persists before one advisory `notes.created` hint. The JSON response is `{note,notification}`; unavailable or unknown publication leaves the note saved. A thrown publisher becomes unknown, since acceptance may already have happened. Hints are neither durable delivery nor a replay log. After reconnect or a hint, recover authoritative state through GET. `X-Operation-Id` is correlation, never an idempotency key; a lost POST response does not justify an automatic retry.

The principal is rechecked immediately before each owner operation, including installation generation and expiry. One admitted operation can finish after concurrent revocation; there is no claim that revocation recalls in-flight I/O.

Run `npm run build && node --test test/notes.test.mjs` after changing notes. The default test checks request validation and session ownership using a controlled authority. To exercise account-scoped reads and lists on the selected native database, set `VCLI_NOTES_TEST_DATABASE_URL` privately to an isolated test database with the notes schema already released. The native test uses two synthetic principals and cleans up its own note.

Use the bundled client without placing credentials in source:

```js
import { createNotesClient } from './clients/notes-client.mjs';

const notes = createNotesClient({ baseUrl: apiOrigin, accessToken });
const created = await notes.create({ title: 'Remember', body: 'Private text' });
const edited = await notes.edit(created.note.id, {
  title: 'Remember tomorrow',
});
const page = await notes.list(20);
const note = await notes.get(edited.id);
await notes.remove(note.id);
```

Place the importing script at the application root or adjust its relative import. `baseUrl` is the API origin and `accessToken` is an async current-token getter. Firebase additionally supplies an async `sessionSecret` getter for the existing enrollment capability; local auth uses its local JWT. The client owns no token store, silently retries no POST and selects no realtime transport.

## Demo fixtures

Apply the selected schema release and build the app. Set `NODE_ENV` to `development` or `test` and set `VCLI_SEED_ACCOUNT_ID` to the ID of an existing enabled account in that database. Create the demo account with the app's selected identity flow, then set `demo_account_id` in your shell to the UUID from the authenticated account response. The seed command checks that the account exists and is enabled. It works for profiles with username-only credentials.

```sh
NODE_ENV=development VCLI_SEED_ACCOUNT_ID="$demo_account_id" make seed MODULE=notes
NODE_ENV=development APP_ENV_FILE=.env.development VCLI_SEED_ACCOUNT_ID="$demo_account_id" npm run db:seed -- --module notes
```

`notes.seed.ts` owns two fixtures with fixed IDs reserved for one demo account per database. Reruns create missing notes and preserve edits. A fixture ID held by a different account causes the Notes seed transaction to fail. The job reports created and already-present counts and does not publish realtime hints.

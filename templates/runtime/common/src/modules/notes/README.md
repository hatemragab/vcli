# Owned notes example

This selected example exposes authenticated `POST /api/notes`, `GET /api/notes?limit=20` and `GET /api/notes/:id`. Create accepts only `{title,body?}`; the verified principal owns the record and the server supplies its ID/time. Titles are trimmed and bounded to 1–120 UTF-16 units; body defaults to empty and is bounded to 10000 units. Reads contain only owned records, with the same 404 for missing/foreign IDs, and list ordering is `createdAt DESC, id DESC` with a 1–100 limit.

Apply the application's explicit selected schema release before startup. `initializeNotes(database)` creates only the selected native `app_notes` schema/index; boot checks availability and never runs this initializer. `createNotesRuntime(config,database,authority,publisher?)` uses the caller-owned database and returns `{module}`. Custom consumers import the configured notes module handle to inject `NotesService` explicitly. Owner persistence methods are internal application capabilities, never an unrestricted HTTP filter API.

Creation persists before one advisory `notes.created` hint. The JSON response is `{note,notification}`; unavailable or unknown publication leaves the note saved. A thrown publisher becomes unknown, since acceptance may already have happened. Hints are neither durable delivery nor a replay log. After reconnect or a hint, recover authoritative state through GET. `X-Operation-Id` is correlation, never an idempotency key; a lost POST response does not justify an automatic retry.

The principal is rechecked immediately before each owner operation, including installation generation and expiry. One admitted operation can finish after concurrent revocation; there is no claim that revocation recalls in-flight I/O.

Run `npm run build && node --test test/notes.test.mjs` after changing notes. The default test checks request validation and session ownership using a controlled authority. To exercise account-scoped reads and lists on the selected native database, set `VCLI_NOTES_TEST_DATABASE_URL` privately to an isolated test database with the notes schema already released. The native test uses two synthetic principals and cleans up its own note.

Use the bundled client without placing credentials in source:

```js
import { createNotesClient } from './clients/notes-client.mjs';

const notes = createNotesClient({ baseUrl: apiOrigin, accessToken });
const created = await notes.create({ title: 'Remember', body: 'Private text' });
const page = await notes.list(20);
const note = await notes.get(created.note.id);
```

Place the importing script at the application root or adjust its relative import. `baseUrl` is the API origin and `accessToken` is an async current-token getter. Firebase additionally supplies an async `sessionSecret` getter for the existing enrollment capability; local auth uses its local JWT. The client owns no token store, silently retries no POST and selects no realtime transport.

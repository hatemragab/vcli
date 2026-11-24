# Full local username authentication

Use `--auth local --local-auth-profile full --local-identifier username` to select the full username/password flow backed by the selected native database. This flow is mail-free and retains installation and session management. Basic local auth also supports usernames and is the default when `--local-auth-profile` is omitted for a new app. Ordinary add/regeneration preserves the installed profile and credential namespace. [Basic local authentication](CLI-IDENTITY.md#basic-local-authentication)

## Runtime and source selection

New common sources:

- `src/modules/identity/username-credentials.service.ts`: `UsernameCredentials(transactions, accounts, identities, passwords, issuer)`.
- `src/modules/identity/username-identity.controller.ts`: `UsernameIdentityController`, with existing local route prefixes and session response contracts.
- `src/modules/identity/username-inputs.ts`: selected strict schemas, emitted as `identity-inputs.ts`.
- `src/modules/identity/username-request-bodies.ts`: selected OpenAPI bodies, emitted as `identity-request-bodies.ts`.
- `clients/auth-username.mjs`: selected `LocalAuthClient`, emitted as `clients/auth-local.mjs`.

The raw username controller/body assets use username-specific imports so combined-template fixtures can compile both profiles. Selected emission rewrites those imports to the normal selected input/body filenames. Password change can keep its existing selected imports. All native account/identity/session stores and transaction boundaries remain selected MongoDB or PostgreSQL implementations.

`UsernameCredentials.register(username, password, accountId, now)` hashes outside the retryable transaction, then atomically creates one account and identity. The identity key is `username:<canonical username>`. Existing identities are never replaced by duplicate registration, including registration after account disable. The public registration response is always accepted and does not issue a session. Username registration provides first-possession of a public name; it proves neither a real-world identity nor email ownership.

`UsernameCredentials.login(username, password, facts)` verifies outside the transaction and rechecks enabled account, active identity, cleanup state, credential version and exact password hash before issuing a session. Conditional password rehashing remains inside that same transaction. Unknown usernames use the existing bounded dummy-password path. Login requires a separately held installation capability, just as email/password login does.

## Public behavior

| Operation                                  | Request                                                             | Result                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/identity/local/register`        | `{username,password}`                                               | 202 accepted; no session or email                                        |
| `POST /api/identity/local/login`           | `{username,password,installationCapability,platform?,allowRebind?}` | Existing JWT/rotating-refresh/session response                           |
| `POST /api/identity/local/refresh`         | `{refreshToken}`                                                    | Single-use refresh rotation; replay revokes that session family          |
| `POST /api/identity/local/password/change` | Current bearer session plus `{currentPassword,newPassword}`         | Requires current password/recent authentication and revokes all sessions |

Usernames have 3–64 ASCII letters, numbers, dots, underscores or hyphens, begin with a letter or number, and are trimmed/canonicalized to lower case. Passwords preserve Unicode exactly and retain the existing 12–128 UTF-16-unit and 256-byte bounds. Installation capabilities remain private canonical 32-byte base64url values.

Accounts are stored with `email: null` and `emailVerified: false`. There is no fabricated verified address. Verification mail, reset mail, verification/reset endpoints and action-token services are absent. The client exposes no email action operation. Forgotten-password recovery is unavailable; an explicit future recovery design is required before offering it. No username-only, public-token or ID-only reset exists.

Existing generation-fenced installations, current authority checks, session lists/revocation, fresh-password account lifecycle and password changes remain active. A mail-free profile must not include a hidden capture sender, SMTP/HTTP provider, mail environment fields or mail SDK dependency merely to satisfy auth composition.

## Verification

`node --test --test-concurrency=1 test/username-runtime.test.ts` compiles both selected native identity source sets into task-local fixtures and executes controlled persistence/password ports. It covers account email facts, duplicate/raced registration, atomic rollback, one hash across simulated retries, unknown/wrong credential handling, stale login, refresh replay, disabled accounts, authenticated password change, strict schemas and the selected client payload.

The runtime suite passed ten cases with zero failures/skips. The generator owner separately ran `node --test --test-concurrency=1 test/username-rendering.test.ts`: all four cases passed, including complete MongoDB and PostgreSQL output with noEmit/lint/acyclic architecture and mail-closure assertions, unchanged email defaults/mail requirements, and pre-write refusal of identifier-mode conversion. The existing shared identity release DDL/markers remain; their inactive action table does not activate an action service, controller, contract or mail provider.

These controlled checks establish application policy and native-source compatibility. They do not establish real database concurrency, native Argon capacity, hosted identity, SMTP or production runtime acceptance. The coordinator separately owns installed CLI generation, prepared MongoDB schema and actual HTTP verification of `examples/test_notes_mongo`.

## Installed CLI and requested example

The coordinator built and privately packed CLI0.1.1, SHA256 `a41111395b69ac5d720050bb3f62d18402843520c7d85b324165b4ee51693d27` (444352 bytes), then installed it offline for the VPS user at `/home/orca/.local/bin/vcli`. Actual interactive init from `examples` asked `Project name` first and accepted `test_notes_mongo`.

The generated example selects MongoDB, username auth, local storage/private media, notes and retained application/database/infrastructure logs. Its source has no mail provider/action service, realtime transport or opposite-database dependencies. Installation and all four generated checks completed; `npm run build` passed and `npm test` passed both foundation cases. The root checks/build,23 engine regressions and three focused CLI name/preview/noninteractive cases passed. Sanitized installation facts are in ignored `var/manual-cli/20261117T075631Z/result.json`.

This step generated, installed and built the project. It did not start MongoDB/the application or create private JWT credentials. Actual prepared-schema MongoDB/HTTP acceptance remains the next runtime step.

# VCLI

VCLI creates and maintains NestJS backends in Hatem Ragab’s coding style. Start with a small HTTP API or choose a database and capabilities at initialization. As the app grows, use its pinned CLI to preview changes, scaffold features, check ownership, and verify the result.

The generated project is ordinary NestJS. It uses flat feature modules, strict TypeScript, one handwritten class per file, explicit dependency injection, and one native database implementation when selected. Nest runs the application. VCLI handles development and release tasks from the project checkout.

## Quick start

Use Node 26.13.1 or newer within Node 26 and npm 11.20.0. From the parent directory where you keep projects, run this to download VCLI, create `my-api`, and install its dependencies.

```sh
npm exec --yes \
  --package=https://github.com/hatemragab/vcli/releases/download/v0.1.2/vcli-cli-0.1.2.tgz \
  -- vcli init my-api --yes
cd my-api
npm run build && npm start
```

Open [the readiness endpoint](http://127.0.0.1:3100/health/ready) once Nest starts. The minimal app needs no database or provider configuration. Run `npm exec -- vcli check` from the app root to verify it with the pinned project CLI.

Commit the generated project, including `tools/vcli/`, the selected auth package if present, `package-lock.json`, and `vcli.lock.json`. On a fresh checkout, `make install` bootstraps the same pinned CLI and records installation.

[Download the tarball](https://github.com/hatemragab/vcli/releases/download/v0.1.2/vcli-cli-0.1.2.tgz) · [SHA-256 checksum](https://github.com/hatemragab/vcli/releases/download/v0.1.2/vcli-cli-0.1.2.tgz.sha256) · [Release notes](https://github.com/hatemragab/vcli/releases/tag/v0.1.2)

### Build from source

```sh
git clone https://github.com/hatemragap/vcli.git vcli_workspace
cd vcli_workspace/vcli_nestjs
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

From the directory where you want to create a new app, invoke `node /path/to/vcli_workspace/vcli_nestjs/bin/vcli.mjs`.

### Connect Firebase

In an app generated with Firebase Auth or FCM and a VCLI version that includes setup, install the [official Firebase CLI](https://firebase.google.com/docs/cli), then run `npm exec -- vcli firebase setup` from the app root. For an existing Firebase project, place its Admin SDK key at `firebase-admin.json` in the app root before linking. For a new Firebase project, create it through the setup command, then save the key and rerun setup. VCLI writes the project ID and relative credential path to `.env.development`.

Use `--existing <project-id>` or `--create <project-id>` for an explicit selection. Use `--adc` when the runtime already has Google credentials, or `--for auth` or `--for fcm` to configure one capability. [Firebase setup details](docs/CLI-IDENTITY.md#link-a-firebase-project)

### Run from VS Code or IntelliJ IDEA

Projects generated from the current source include **VCLI: Install**, **VCLI: Dev**, **VCLI: Build**, **VCLI: Start**, **VCLI: Check**, and **VCLI: Test**. Open the app root and select an action through **Tasks: Run Task** in VS Code or the **Run** menu in IntelliJ IDEA with the Makefile plugin enabled. The actions call the matching Make targets in the app root. The IDE needs `make`, `node`, and `npm` on its `PATH`.

Run **VCLI: Install** on a fresh checkout and **VCLI: Build** before **VCLI: Start**. **VCLI: Dev** launches the development watcher. Dev and Start use the Makefile's private config selection. Run database setup and seeding separately when the project needs them. To add the IDE files to an existing generated project, preview the update from the built target CLI. [Upgrade guide](docs/CLI-MAINTENANCE.md)

## Start with a database and authentication

This example uses a CLI built from the current checkout and linked as `vcli`. From the directory where you want to create an app, generate a basic email/password API with MongoDB, private local storage, diagnostics, and Dokploy artifacts.

```sh
vcli init my-new-api-2 --yes --database mongodb --auth local \
  --storage local --diagnostics --deploy dokploy
cd my-new-api-2
```

New local-auth apps default to basic email/password authentication. Add `--local-identifier username` to use normalized usernames instead. Register at `POST /api/identity/local/register`, log in immediately at `POST /api/identity/local/login`, and send the returned bearer access token to `GET /api/accounts/me`. Basic auth uses an expiring JWT and requires no mail or device enrollment. Use `--mail` explicitly if the application needs to send mail. [Identity contract](docs/CLI-IDENTITY.md#basic-local-authentication)

VCLI fixes the database choice at init and emits its schema, driver, and native `BaseRepository`. The default MongoDB development URL selects a database named for the project on a local replica set named `rs0` with a writable primary. Use `--database postgres` for PostgreSQL and set its private `DATABASE_URL` to match your credentials. Auth uses Redis for short-lived rate-limit counters. VCLI creates a gitignored, mode `0600` `.env.development` with the local database URL, `REDIS_URL=redis://127.0.0.1:6379`, and a freshly generated local JWT signing key. Local storage supports macOS and Linux. Once the selected services are ready, run `make first-run` to build, apply the schema release, and start the development watcher. With a custom development file, pass `CONFIG_FILE=path/to/private.env` to use it for both the release and the watcher.

With local storage selected, init creates a private, Git-ignored `storage/` directory. Owned uploads are saved under `storage/<userId>/objects/`, and the database holds the authenticated URL or storage reference. Init also generates the selected app-owned development secrets, including JWT signing, reliable mail encryption, and Centrifugo keys. Configure external provider credentials privately.

To run the steps separately, use the same private development file throughout.

```sh
npm exec -- vcli config check --config-file .env.development
npm run build
npm exec -- vcli release apply --config-file .env.development
npm exec -- vcli dev --config-file .env.development
```

Visit `/docs` for the API schema. For production, supply the database URL, Redis URL, signing keys, and selected capability settings privately. The Dokploy selection writes Compose, environment, and platform settings under `ops/deploy/dokploy/`. [Manual Dokploy Compose setup](docs/CLI-DEPLOYMENT-OPERATORS.md#manual-dokploy-compose-setup)

For optional Docker-based Redis, add `--redis-docker` to the auth-enabled `init` command. Start it explicitly with `docker compose -f ops/compose.redis.development.yml up -d` from the app root. The same Compose command with `down` stops it. It binds loopback on port `6379`. To use another free port, set `VCLI_REDIS_PORT` for Compose and match it in the private `REDIS_URL`. [Local service commands](docs/CLI-OPERATIONS.md)

### Full local auth and Notes

Select `--local-auth-profile full` at init for local-auth features that use installations or sessions, including private media, push, realtime, and `--notes`. Full email/password auth uses a mail provider for verification and recovery. Set `--mail smtp` or `--mail http` for Resend when configuring real delivery. Development capture is limited to development and test. Existing projects keep their pinned profile.

This example selects PostgreSQL, full username/password auth, and Notes. Run it from the parent directory where the project should live.

```sh
vcli init notes-api --yes --database postgres --auth local \
  --local-auth-profile full --local-identifier username --notes
cd notes-api
```

Database-backed projects generated from the current source include an explicit development/test seed command. Start the database, build the app, apply its schema release, and create an enabled demo account through the app's configured sign-in flow. Set `demo_account_id` to that account's `id` from authenticated `GET /api/accounts/me`.

```sh
make seed VCLI_SEED_ACCOUNT_ID="$demo_account_id"
make seed MODULE=notes VCLI_SEED_ACCOUNT_ID="$demo_account_id"
NODE_ENV=development APP_ENV_FILE=.env.development VCLI_SEED_ACCOUNT_ID="$demo_account_id" npm run db:seed -- --module notes
```

The first command runs all registered seeders. The filtered commands run only Notes. Reruns preserve edits and print created and already-present counts for each selected module. See the generated README for test configuration and the Notes guide for the demo-account constraints.

### Check a client connection

Start the selected app and use its API origin. The OpenAPI export reads the running app's contract. The Notes smoke check uses two verified full-local-auth accounts, each supplied as an `email` or `username` plus `password` in the `accounts` array of an owner-only JSON file.

```sh
npm exec -- vcli openapi export --url http://127.0.0.1:3100 --out openapi.json
npm exec -- vcli smoke notes --url http://127.0.0.1:3100 --accounts-file .vcli/local/smoke-accounts.json
```

The smoke check uses temporary sessions and test records. It verifies edits between two installations, sign-out of the selected installation, cross-account isolation, and note deletion. When private Media is selected, it checks image upload, download, and ownership through the mediated transfer mode. Run it against a local development or test app.

## Work on an existing project

Run these from the app root.

| Task                                                                   | Command                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| See selected capabilities, install state, and the last recorded checks | `npm exec -- vcli inspect --json`                   |
| Check how a file was generated and who owns it                         | `npm exec -- vcli explain src/app.custom.module.ts` |
| Browse the available capabilities                                      | `npm exec -- vcli catalog --verbose`                |
| Preview a capability addition                                          | `npm exec -- vcli add storage.local --dry-run`      |
| Preview a new feature                                                  | `npm exec -- vcli g feature invoices --dry-run`     |
| Run architecture, database isolation, lint, and TypeScript checks      | `npm exec -- vcli check`                            |

Review a preview, then rerun the command without `--dry-run` when ready. Add the feature module to `imports` in `src/app.custom.module.ts`. Import each capability directly in the feature module that uses it. Keep HTTP validation in controllers and business rules, authorization, and persistence in the owning feature. For a new table or index, register a versioned change in `src/release/custom-migrations.ts`. Release application and startup readiness use the same schema manifest. [Architecture](docs/ARCHITECTURE.md) · [Migration guide](docs/CLI-RELEASE.md)

In an app with private Media, `npm exec -- vcli g feature albums --use media` wires `MediaModule` and `MediaService` into the scaffold.

In MongoDB apps, `g feature orders` and `g repository orders` generate an `orders.entity.ts` with a Mongoose `new Schema(...)` definition. Add fields and indexes to that schema.

In a database-backed app, `g feature orders` also creates `src/modules/orders/orders.seed.ts`. Implement its fixtures inside the owning feature, then import `seedOrders` in `src/seed/custom-seeders.ts` and add `{ module: 'orders', run: seedOrders }` to `customSeeders`. Rebuild before `make seed MODULE=orders`. Use versioned migrations for permanent application-required data.

`vcli.json` records the desired stack. `vcli.lock.json` records realized choices, ownership, and source, installation, and check outcomes. VCLI updates managed files and preserves edited business scaffolds and your application version. Use the target release CLI to preview upgrades before applying them. [Upgrade guide](docs/CLI-MAINTENANCE.md)

## Keep AI context with the code

Generated apps include `AGENTS.md` for Codex and Grok Build. Claude Code imports the same file through `CLAUDE.md`. The guide describes the selected stack, where to make changes, how to use the CLI, and which checks to run.

Write durable project rules below the managed block in `AGENTS.md`. Include decisions such as who can cancel an invoice, which feature owns a field, and which test proves the behavior. VCLI refreshes its own guidance as capabilities change and preserves your project rules. Keep provider-specific instructions with the feature that needs them.

## Capabilities and verification

| Area                  | Available choices                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Database and identity | PostgreSQL with Drizzle or MongoDB with Mongoose. Basic or full local auth with email or username, and Firebase identity.                      |
| Realtime              | Socket.IO, native WebSocket, or Centrifugo, with documented scale profiles.                                                                    |
| Email and push        | Development capture, SMTP, or Resend. Purpose-specific FCM and APNs integrations.                                                              |
| Storage               | Private local storage, AWS S3, or Cloudflare R2, with upload modes supported by the selected provider.                                         |
| Operations            | Local services, schema releases, backups, retained diagnostics and optional read-only MCP. Dokploy, Coolify, and CapRover deployment profiles. |

Use `catalog` for prerequisites and supported combinations. The `0.1.2` verification covers a fresh Git clone, upgrades from an existing project, custom schema releases, and notes ownership on both native databases. Hosted-provider, device, and live-deployment acceptance remain pending. [Recipe catalog](docs/CLI-RECIPES.md) · [Verification](docs/CLI-VERIFICATION.md)

For work on VCLI itself, start with [contributor instructions](AGENTS.md), the [source map](START-HERE.md), and the [architecture](docs/ARCHITECTURE.md). See the [generated project structure guide](docs/CLI-STRUCTURE.md) for the expected NestJS layout.

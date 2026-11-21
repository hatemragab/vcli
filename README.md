# VCLI

VCLI creates and maintains NestJS backends in Hatem Ragab’s coding style. Start with a small HTTP API or choose a database and capabilities at initialization. As the app grows, use its pinned CLI to preview changes, scaffold features, check ownership, and verify the result.

The generated project is ordinary NestJS. It uses flat feature modules, strict TypeScript, one handwritten class per file, explicit dependency injection, and one native database implementation when selected. Nest runs the application. VCLI handles development and release tasks from the project checkout.

## Quick start

Use Node 26.13.1 or newer within Node 26, npm 11.20.0, and Make. Download `vcli-cli-0.1.2.tgz` from the [private GitHub release](https://github.com/hatemragab/vcli/releases/tag/v0.1.2). From a parent directory where you keep projects, install the tarball and create a minimal API.

```sh
mkdir vcli-tool
cd vcli-tool
npm install --no-audit --no-fund ../vcli-cli-0.1.2.tgz
cd ..
./vcli-tool/node_modules/.bin/vcli init my-api --yes --skip-install
cd my-api
make install
npm exec -- vcli check
npm run build
npm start
```

Open `http://127.0.0.1:3100/health/ready` once Nest starts. The minimal app needs no database or provider configuration. Commit the generated project, including `tools/vcli/`, the selected auth package if present, `package-lock.json`, and `vcli.lock.json`. On the next Git checkout, `make install` bootstraps the same pinned CLI and records installation.

To build the generator from source, clone this repository and run `npm ci --ignore-scripts --no-audit --no-fund` and `npm run build`. Invoke the resulting `node path/to/vcli/bin/vcli.mjs` from the parent directory where you want the new app created.

## Start with a database and authentication

This example selects PostgreSQL, local username/password authentication, and a working notes feature. Run it from the parent directory where the new project should live.

```sh
./vcli-tool/node_modules/.bin/vcli init notes-api --yes --skip-install \
  --database postgres --auth local --local-identifier username --notes
cd notes-api
make install
```

Use `--database mongodb` for the MongoDB variant. VCLI fixes the database choice at init and emits its schema, driver, and native `BaseRepository` in the app. The vendored CLI carries templates for the full catalog. Username authentication has no email recovery flow. If you want email verification and password reset with real delivery, select local email authentication with `--mail smtp` or `--mail http` for Resend at init. The unattended `api` preset defaults to development capture, which production rejects.

Use the generated README to start the selected database and fill the required values in a private, owner-only config file. With that database running, use the same file for config validation, schema release, and development.

```sh
npm exec -- vcli config check --config-file .env.development
npm run build
npm exec -- vcli release apply --config-file .env.development
npm exec -- vcli dev --config-file .env.development
```

For selected auth profiles, visit `/docs` for the API schema. See the [generated MongoDB example](examples/test_notes_mongo/README.md) for a project with notes, private media, and diagnostics.

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

Review a preview, then rerun the command without `--dry-run` when ready. Register a new feature in `src/app.custom.module.ts` and explicitly pass the configured modules it consumes. Keep HTTP validation in controllers and business rules, authorization, and persistence in the owning feature. For a new table or index, register a versioned change in `src/release/custom-migrations.ts`. Release application and startup readiness use the same schema manifest. [Architecture](docs/ARCHITECTURE.md) · [Migration guide](docs/CLI-RELEASE.md)

`vcli.json` records the desired stack. `vcli.lock.json` records realized choices, ownership, and source, installation, and check outcomes. VCLI updates managed files and preserves edited business scaffolds and your application version. Use the target release CLI to preview upgrades before applying them. [Upgrade guide](docs/CLI-MAINTENANCE.md)

## Keep AI context with the code

Generated apps include `AGENTS.md` for Codex and Grok Build. Claude Code imports the same file through `CLAUDE.md`. The guide describes the selected stack, where to make changes, how to use the CLI, and which checks to run.

Write durable project rules below the managed block in `AGENTS.md`. Include decisions such as who can cancel an invoice, which feature owns a field, and which test proves the behavior. VCLI refreshes its own guidance as capabilities change and preserves your project rules. Keep provider-specific instructions with the feature that needs them.

## Capabilities and verification

| Area                  | Available choices                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Database and identity | PostgreSQL with Drizzle or MongoDB with Mongoose. Local email/password, local username/password, and Firebase identity.                        |
| Realtime              | Socket.IO, native WebSocket, or Centrifugo, with documented scale profiles.                                                                    |
| Email and push        | Development capture, SMTP, or Resend. Purpose-specific FCM and APNs integrations.                                                              |
| Storage               | Private local storage, AWS S3, or Cloudflare R2, with upload modes supported by the selected provider.                                         |
| Operations            | Local services, schema releases, backups, retained diagnostics and optional read-only MCP. Dokploy, Coolify, and CapRover deployment profiles. |

Use `catalog` for prerequisites and supported combinations. The `0.1.2` verification covers a fresh Git clone, upgrades from an existing project, custom schema releases, and notes ownership on both native databases. Hosted-provider, device, and live-deployment acceptance remain pending. [Recipe catalog](docs/CLI-RECIPES.md) · [Verification](docs/CLI-VERIFICATION.md) · [Phase status](phases/STATUS.md)

For work on VCLI itself, start with [contributor instructions](AGENTS.md), the [source map](START-HERE.md), and the [architecture](docs/ARCHITECTURE.md). The [hand-built reference apps](examples/README.md) document the expected NestJS layout and their own verification.

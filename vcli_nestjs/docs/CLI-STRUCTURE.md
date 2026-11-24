# VCLI and generated application structure

The CLI and the application it produces are separate codebases. The tool contains both template variants. A generated application contains exactly one database implementation.

## CLI repository

```text
bin/vcli.mjs                 executable
src/cli.ts                   command registration
src/commands/                validated arguments and public results
src/engine/                  plans, file ownership, install state, journals/recovery
src/recipes/                 selected source/configuration/asset rendering
src/services/                ordinary local Nest/Compose process wrappers
src/deployment/operators/    scoped Dokploy, Coolify and CapRover operations
src/maintenance/             admitted upgrade profiles and finite copied patches
packages/auth-runtime/       narrow optional-peer crypto patch boundary
templates/runtime/
  common/                    shared selected capability code
  mongodb/                   MongoDB-only templates
  postgres/                  PostgreSQL-only templates
```

## Generated application

```text
src/
  main.ts                    startup and signals
  create-app.ts              explicit selected composition and cleanup
  app.custom.module.ts       static imports for developer features
  core/
    database/                the chosen native BaseRepository and transactions
    auth/                    small shared authority/session facts
    config/                  selected environment validation
    http/                    guards, validation and safe errors
    logging/                 finite structured events
  modules/
    accounts/
      account.entity.ts
      account.service.ts     extends the selected BaseRepository
      account.module.ts
      current-account.controller.ts
    identity/                selected auth and focused lifecycle services
    installations/
    sessions/
    notes/                   optional explicit functional REST example
    mail/                    selected transport and optional durable intents
    storage/                 selected final store and bounded private staging
    media/                   ownership, quota and immutable transfer lifecycle
    push/                    selected FCM/APNs purposes and generation fences
    realtime/                one selected protocol, native shared tickets
    diagnostics/             selected retained sources/readers/MCP
  generated/                 tool-owned composition and selected release manifest
  release/                   explicit release/backup/isolated restore commands
clients/                     only the selected executable examples
ops/                         selected local, diagnostic and target assets
migrations/                  selected SQL assets when required
Makefile
vcli.json                    desired choices
vcli.lock.json               ownership and separate source/install/check state
```

Modules stay flat: entity, service, module and optional controller/focused helpers. No mandatory adapters/application/domain/ports/public folder hierarchy is emitted. One class per file and runtime/type/feature cycle checks are enforced. Core does not import feature internals. No forwardRef, global locator or hidden provider discovery is used.

`AccountService`, `InstallationService`, `SessionService` and notes data services inherit native repository helpers. MongoDB keeps native filters, projections, sessions, population/aggregation/bulk support. PostgreSQL keeps Drizzle SQL/columns/conflict targets. There is no runtime database branch or universal filter adapter. Security-sensitive conditional writes and shared transactions remain explicit owner operations; controllers do not expose unrestricted repository filters.

To render MongoDB and PostgreSQL review projects locally, run `npm run build` and then `node scripts/render-review-projects.ts`. The script writes the review projects under `var/generated-reviews/`. See [CLI verification](CLI-VERIFICATION.md) for build evidence and external setup limits.

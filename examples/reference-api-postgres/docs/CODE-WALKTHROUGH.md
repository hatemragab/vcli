# Read the compact reference code

Start with `src/modules/accounts` or `src/modules/notes`. These show the structure approved by the owner. This is a hand-built expected-output app; VCLI itself is still unimplemented.

```text
modules/accounts/                 modules/notes/
  account.entity.ts                notes.entity.ts
  account.service.ts               notes.service.ts
  account.module.ts                notes.module.ts
  current-account.controller.ts    notes.controller.ts
```

The entity file owns the data type and schema. The service extends `BaseRepository<T>`, inherits useful database operations and adds feature-specific methods. The module provides/exports the service for Nest injection. The controller validates HTTP input, obtains verified identity and calls the feature service.

## Inherited database methods

Read [BaseRepository](../src/core/database/base-repository.ts), then [AccountService](../src/modules/accounts/account.service.ts). AccountService's constructor supplies its own schema/table mapping to the shared base. It does not implement common CRUD again.

```typescript
const account = await accountService.findById(accountId);
const verified = await accountService.findByIdOrThrow(accountId);
const page = await accountService.findWithPagination(
  { page: 1, limit: 10 },
  eq(accountTable.enabled, true),
);
```

These are internal service calls. Controllers expose deliberate operations with authorization and validated inputs, not arbitrary caller-supplied database filters. The generic base accepts native Drizzle SQL conditions built with owner-defined columns. See [all repository methods](base-repository.md). Specialized operations such as account locking, refresh consumption, media quotas and push generation fencing remain explicit methods.

Omitting `options.context` starts a serializable transaction; passing the current opaque context reuses it. `createMany` is atomic across SQL batches. Pagination shares a snapshot, returned records are plain values, and `fields` produces honest `Pick<T,K>` projections. This standalone reference contains only PostgreSQL/Drizzle + pg.

## Follow a request

1. [NotesController](../src/modules/notes/notes.controller.ts) validates the body and receives the verified principal from the shared guard/decorator.
2. [NotesService](../src/modules/notes/notes.service.ts) validates the note and saves through inherited `create`.
3. The shared selected database repository executes the write.
4. After commit, the service attempts advisory realtime publication and returns both outcomes.
5. `getOwned` and `listOwned` constrain reads to the verified account.

Notes has four files. It no longer needs separate create/read operation classes, reader/writer ports, provider-specific owner store classes or injection-token wrappers. Its explicit schema initializer creates the PostgreSQL table and owner/order index safely on repeated setup; run the documented release setup before startup.

## Other services

MailService, StorageService, PushService, RealtimeService and DiagnosticsService are directly injectable through their feature modules. Local/SMTP/S3/protocol-specific implementations remain focused classes in flat directories. Complex security and protocol features retain the helper services they actually need. One handwritten class has one file.

## Prevent circular dependencies

Core never imports a feature. Features import only the services/contracts they need. Multi-feature coordination sits above participants. Shared neutral facts can move to core; feature-specific behavior stays with its owner.

```sh
make check-architecture
```

The check includes runtime imports, type imports and re-exports; it rejects both file cycles and feature-level cycles. It also rejects forwardRef, ModuleRef, global modules and hidden dynamic loading. Both `npm run build` and `npm run check` invoke it automatically. Tests introduce prohibited dependency shapes and verify rejection.

See [the complete actual tree](PROJECT-TREE.md), [architecture](architecture.md) and [current verification](VERIFICATION.md).

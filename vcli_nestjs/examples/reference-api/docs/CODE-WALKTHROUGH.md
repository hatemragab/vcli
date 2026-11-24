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

Read [BaseRepository](../src/core/database/base-repository.ts), then [AccountService](../src/modules/accounts/account.service.ts). AccountService's constructor supplies its own Mongoose model name and schema to the shared base. It does not implement common CRUD again.

```typescript
const account = await accountService.findById(accountId);
const verified = await accountService.findByIdOrThrow(accountId);
const page = await accountService.findWithPagination(
  { page: 1, limit: 10 },
  { enabled: true },
);
```

These are internal service calls. Controllers expose deliberate operations with authorization and validated inputs, not arbitrary caller-supplied database filters. The generic base supports native typed Mongoose filters, update operators, projections, sorting, population, aggregation and bulk operations. Read the [complete catalog and semantics](base-repository.md). Specialized operations such as account locking, refresh consumption, media quotas and push generation fencing remain explicit methods.

Ordinary operations use native Mongo atomicity and can join the caller's explicit `{ context }` or native session. `createMany` runs validated saves sequentially in one transaction and rolls back on failure; pagination queries run sequentially on a shared session. Default results contain the public record, projected/populated overloads return honest view types, and ID predicates use Mongo's indexed string `_id`. The app has one selected MongoDB implementation, while the separate PostgreSQL reference owns its own source and dependencies.

## Follow a request

1. [NotesController](../src/modules/notes/notes.controller.ts) validates the body and receives the verified principal from the shared guard/decorator.
2. [NotesService](../src/modules/notes/notes.service.ts) validates the note and saves through inherited `create`.
3. The inherited repository uses its protected Mongoose model to execute the write.
4. After commit, the service attempts advisory realtime publication and returns both outcomes.
5. `getOwned` and `listOwned` constrain reads to the verified account.

Notes has four files. It no longer needs separate create/read operation classes, reader/writer ports, provider-specific owner store classes or injection-token wrappers. Its explicit schema initializer preserves previous Mongo string-_id notes by backfilling the stored id field; run the documented release setup before using the changed schema.

## Other services

MailService, StorageService, PushService, RealtimeService and DiagnosticsService are directly injectable through their feature modules. Local/SMTP/S3/protocol-specific implementations remain focused classes in flat directories. Complex security and protocol features retain the helper services they actually need. One handwritten class has one file.

## Prevent circular dependencies

Core never imports a feature. Features import only the services/contracts they need. Multi-feature coordination sits above participants. Shared neutral facts can move to core; feature-specific behavior stays with its owner.

```sh
make check-architecture
```

The check includes runtime imports, type imports and re-exports; it rejects both file cycles and feature-level cycles. It also rejects forwardRef, ModuleRef, global modules and hidden dynamic loading. Both `npm run build` and `npm run check` invoke it automatically. Tests introduce prohibited dependency shapes and verify rejection.

See [the complete actual tree](PROJECT-TREE.md), [architecture](architecture.md) and [current verification](VERIFICATION.md).

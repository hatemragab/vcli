# Native PostgreSQL implementation contract

The current task follows [the shared native-database contract](../../NATIVE-DATABASE-CONTRACT.md). This independent app is fixed to PostgreSQL/Drizzle + pg, with native owner schemas and SQL repository methods. VCLI remains unimplemented.

The PostgreSQL implementation worker owns app files except the lock, tooling/compiled/ignored outputs and the isolation checker's files. The coordinator owns installation/lock resolution, builds and real service/HTTP/protocol/browser acceptance. Concurrent shared logging/bootstrap work has separate ownership and is preserved.

Follow flat Nest modules, one class per file, strict TypeScript, single quotes, explicit injection/exports and acyclic file/type/feature imports. Core imports no features. Controllers expose intentional authorized operations; native repositories remain internal service capabilities. No second driver, runtime DB union/selector, portable adapter, Mongoose schemas or application memory database may remain.

Preserve auth/session/rate behavior, proof-holder credential establishment, atomic revocation and refresh, row locks and shared serializable transaction contexts, unknown commit outcomes, immutable private media, push generation fences, realtime cleanup and safe errors. External effects stay outside retryable callbacks. The native repository's exact catalog/bounds/projection/write semantics are in [base-repository.md](base-repository.md).

Worker checks are scoped noEmit, lint and formatting only; no installs, services, builds, deployment, worktrees or commits. All new runtime evidence is pending until the coordinator records it. Earlier combined-source checks are historical, separate from selected native app acceptance and generator phase completion.

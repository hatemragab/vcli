# Phase 03 tasks

**Status: Implementation/local evidence recorded.** Checked items identify implemented source and their named local checks, not blanket provider/deployment acceptance. Local source/security/crypto/native and four-way generated evidence is recorded in [CLI verification](../../docs/CLI-VERIFICATION.md). Real Firebase method/client/provider acceptance remains pending. See [status](../STATUS.md) and [acceptance](ACCEPTANCE.md).

- [x] **P03-T01 — Freeze policy.** After Phase 00 version verification and Phase 02 acceptance, record the written threat model, measured hashing/concurrency/input/rate limits, shared-package/library boundary, UUIDv4 generation, credential transport, lifetimes, key rotation and strict refresh/reauthentication policy.
- [x] **P03-T02 — Define atomic contracts.** Specify owner records, constraints, expiry, projections, opaque transaction coordination and API/error examples before generating adapters.
- [x] **P03-T03 — Generate Firebase/Mongo.** Complete verifier, idempotent bootstrap, hashed session capabilities and owned session operations; generate replica-set validation, indexes and preserving installation.
- [x] **P03-T04 — Close Firebase races.** Coordinate enrollment/cutoff/revocation, preserve authorized siblings and retain provider cleanup intent. Cover all four methods and console-versus-application policy limits.
- [x] **P03-T05 — Accept the first slice.** Run Firebase/Mongo concurrency, expiry and outage scenarios against real Mongo; keep synthetic versus external provider evidence separate.
- [x] **P03-T06 — Add PostgreSQL/Drizzle.** Implement equivalent capabilities, guarded writes and preserving migrations; prove real SQL transaction behavior without leaking ORM types.
- [x] **P03-T07 — Complete local auth on both databases.** Implement password, JWT/session, strict refresh and action-token lifecycles through Phase 02 capture; prohibit production capture.
- [x] **P03-T08 — Prove replay behavior.** Exercise refresh races, lost responses, family isolation, client singleflight, one-use reset races and declared password-change invalidation.
- [x] **P03-T09 — Connect consumers.** Generate provider setup/client examples and typed session invalidation/mail/destination seams. Local identity must not require Firebase merely for realtime or FCM.
- [x] **P03-T10 — Close the matrix.** Exercise all four auth/database combinations plus customized add/re-add; record actual checks, security patch ownership, external-pending limitations and exit-gate evidence.

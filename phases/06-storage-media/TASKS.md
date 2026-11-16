# Phase 06 tasks

All tasks are planned. Follow [design](README.md), [acceptance](ACCEPTANCE.md), [status](../STATUS.md).

- [ ] **P06-T01 — Select profiles and policies.** Confirm AWS plus first compatible provider, allowed transfer modes, integrity requirements, size/expiry/quota/serving policies and exact SDK versions. Record unsupported operations.
- [ ] **P06-T02 — Define owner contracts/state.** Specify media/attempt transitions, identity, conditional writes, committed-reference immutability and typed errors. Write Mongo/PostgreSQL mappings/migrations with no generic SDK escape.
- [ ] **P06-T03 — Implement local transfer.** Private root, streaming limits, exclusive/race-resistant paths, abort cleanup and safe finalize/read/delete. Reject traversal/symlinks; avoid public static exposure.
- [ ] **P06-T04 — Implement S3 profile client.** Configure explicit endpoint/signing/checksum/addressing/credential behavior; add profile descriptors and requirement validation without assuming AWS parity.
- [ ] **P06-T05 — Implement grant/finalize workflow.** Unique attempts, required transfer bounds, provider evidence, conditional/version/promoted immutable reference and DB transition. Reconcile timeout/DB-failure outcomes before retry.
- [ ] **P06-T06 — Add verified multipart.** Backend-owned initiation/completion, scoped part grants, validated manifests and required final condition/version evidence. Refuse unsupported modes instead of weakening guarantees.
- [ ] **P06-T07 — Implement serving and cleanup.** Authorized bounded download, immutable version binding, attachment/nosniff/origin policy; expiry/delete/abort jobs with generation fences and protected references.
- [ ] **P06-T08 — Generate integration artifacts.** Owned wiring/config/example keys, route/client examples, provider CORS/lifecycle/private-bucket setup and volume/backup requirements. Preserve secrets/customizations.
- [ ] **P06-T09 — Prove failure and race behavior.** Run local and real DB tests for finalize/replay/delete/concurrency, plus stream/cancel/path/size tests. Validate browser signed headers/CORS on named providers.
- [ ] **P06-T10 — Record real provider conformance.** Exercise AWS and selected compatible provider per operation/mode. Date SDK/profile evidence and keep unsupported or unavailable cases pending.

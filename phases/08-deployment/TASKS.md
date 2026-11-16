# Phase 08 tasks

**Status: Planned — implementation not started.** All tasks remain unchecked. Use [design](README.md), [acceptance](ACCEPTANCE.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Record actual target/profile progress in [status](../STATUS.md).

- [ ] **P08-T01 — Confirm platform contracts.** Recheck versions/docs, artifact formats, authentication, dependency modes, lifecycle limitations, and platform-specific evidence requirements for all three targets.
- [ ] **P08-T02 — Finalize service-plan boundary.** Describe finite services, ingress, variables, health, volumes, dependencies, release jobs, worker/scheduler ownership, and early unsupported-combination errors.
- [ ] **P08-T03 — Separate rendering/operation.** Define renderer output ownership and operator permissions, stale-state preconditions, progress records, and uncertain-outcome reconciliation.
- [ ] **P08-T04 — Render every target.** Add Dokploy, Coolify, and CapRover artifacts/runbooks plus private-variable mappings and state inventories. Include CapRover's explicit preprovisioned-dependency profile.
- [ ] **P08-T05 — Implement release migration procedure.** Add a dedicated coordinated command, concurrency/history controls, failure handling, readiness gates, and compatible rollback guidance.
- [ ] **P08-T06 — Implement Dokploy API apply.** Exercise deliberately authorized discovery/apply/verify, stable resource identities, partial status, and safe retries against the declared real profile.
- [ ] **P08-T07 — Implement remaining operators.** Complete Coolify and CapRover independently. Keep each pending before actual evidence; do not substitute Dokploy results or remove target scope.
- [ ] **P08-T08 — Exercise persistence/recovery.** Verify stateful restart, migration failure, volume preservation, isolated backup restore, and each advertised scale profile.
- [ ] **P08-T09 — Review completion claims.** Retain target-specific acceptance, generated-file/customization checks, runbooks, operator permissions, and limitations. Separate artifact support from live operation support.

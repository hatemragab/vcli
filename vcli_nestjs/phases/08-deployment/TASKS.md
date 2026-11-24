# Phase 08 tasks

**Status: Implementation/local evidence recorded.** Checked items identify implemented source and their named local checks, not blanket provider/deployment acceptance. All artifacts/operators/release/restore source is implemented, with real local image/services/native restore and controlled target protocols. Actual authorized live platform/TLS/scale profiles remain pending. See [status](../STATUS.md) and [acceptance](ACCEPTANCE.md).

- [x] **P08-T01 — Confirm platform contracts.** Recheck versions/docs, artifact formats, authentication, dependency modes, lifecycle limitations, and platform-specific evidence requirements for all three targets.
- [x] **P08-T02 — Finalize service-plan boundary.** Describe finite services, ingress, variables, health, volumes, dependencies, release jobs, worker/scheduler ownership, and early unsupported-combination errors.
- [x] **P08-T03 — Separate rendering/operation.** Define renderer output ownership and operator permissions, stale-state preconditions, progress records, and uncertain-outcome reconciliation.
- [x] **P08-T04 — Render every target.** Add Dokploy, Coolify, and CapRover artifacts/runbooks plus private-variable mappings and state inventories. Include CapRover's explicit preprovisioned-dependency profile.
- [x] **P08-T05 — Implement release migration procedure.** Add a dedicated coordinated command, concurrency/history controls, failure handling, readiness gates, and compatible rollback guidance.
- [ ] **P08-T06 — Implement Dokploy API apply.** Exercise deliberately authorized discovery/apply/verify, stable resource identities, partial status, and safe retries against the declared real profile.
- [ ] **P08-T07 — Implement remaining operators.** Complete Coolify and CapRover independently. Keep each pending before actual evidence; do not substitute Dokploy results or remove target scope.
- [ ] **P08-T08 — Exercise persistence/recovery.** Verify stateful restart, migration failure, volume preservation, isolated backup restore, and each advertised scale profile.
- [x] **P08-T09 — Review completion claims.** Retain target-specific acceptance, generated-file/customization checks, runbooks, operator permissions, and limitations. Separate artifact support from live operation support.

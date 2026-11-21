# Phase 01 tasks

**Status: implemented locally for the private Linux bootstrap profile.** See [per-ID evidence](../../docs/CLI-VERIFICATION.md#phase-acceptance-mapping). The checked bootstrap tasks have [recorded local evidence](../../docs/CLI-VERIFICATION.md); later catalog gates remain separate. Use the [phase design](README.md), [acceptance scenarios](ACCEPTANCE.md), and [status board](../STATUS.md).

- [x] **P01-T01 — Confirm entry decisions.** Record Phase 00's toolchain, host policy, validation choice, command naming, and release/patch owner.
- [x] **P01-T02 — Define command results.** Specify stable errors, noninteractive behavior, JSON/stdout and diagnostic/stderr separation, and exit statuses.
- [x] **P01-T03 — Define project state.** Implement validated desired/realized schemas, coordinated versions, partial-state labels, and managed-path ownership metadata.
- [x] **P01-T04 — Establish the registry.** Add foundation and deterministic DAG validation; exercise missing requirements/cycles without a solver/plugin system.
- [x] **P01-T05 — Protect destinations.** Define empty-directory/Git handling, path containment, symlink policy, and expected absence before creation.
- [x] **P01-T06 — Produce the blueprint.** Generate explicit composition, configuration, HTTP errors, structured logging, health, and shutdown without provider dependencies.
- [x] **P01-T07 — Produce guidance.** Generate scripts, agent/ownership rules, extension examples, environment examples, and ignored local/private files.
- [x] **P01-T08 — Implement preview/apply.** Keep preview pure; distinguish source and separately requested installation; preserve newly appearing files on failure.
- [x] **P01-T09 — Implement inspect/doctor.** Report realized/check state and compatibility without secrets, hidden probes, or automatic tool downloads.
- [x] **P01-T10 — Exercise output.** Run acceptance generation, static, build/boot, and HTTP scenarios; record setup/download blockers separately.
- [x] **P01-T11 — Review packaging.** Verify local pinning, no CLI runtime requirement, licenses, patch ownership, and absence of private/machine-specific fixtures.
- [x] **P01-T12 — Close the gate.** Attach evidence/limitations, update status accurately, and hand lifecycle follow-ups to Phase 02.

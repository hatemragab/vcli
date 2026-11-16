# Phase 07 tasks

**Status: Planned — implementation not started.** All tasks are unchecked. Follow [design](README.md), [acceptance](ACCEPTANCE.md), [architecture](../../docs/ARCHITECTURE.md), [decisions](../../docs/DECISIONS.md), and [verification](../../docs/VERIFICATION.md). Update [status](../STATUS.md) only with retained evidence.

- [ ] **P07-T01 — Confirm contracts.** Map API/worker/database/infrastructure sources; record event/filter schemas, bounds, versions, transports, and profile trust boundaries.
- [ ] **P07-T02 — Extend logging/context.** Reuse foundation logging, propagate approved async/job/run context, and preserve infrastructure parse/source observations without private payloads.
- [ ] **P07-T03 — Generate collector/viewer recipes.** Add Vector/Logdy configuration, dependencies, private bindings, examples, setup guidance, and customization-safe transforms.
- [ ] **P07-T04 — Implement retained local evidence.** Add rotated JSONL, bounded reader queries, scoped cursors, expiration, drop reporting, and owned-evidence retention cleanup.
- [ ] **P07-T05 — Implement read-only MCP.** Validate queries, authorize project/environment/run access, return data-only results, and exclude path/shell/SQL/Docker/deploy operations.
- [ ] **P07-T06 — Enforce access profiles.** Separate collector/viewer/reader privileges; document same-user limits, test stronger isolation, and declare remote credential/network needs independently.
- [ ] **P07-T07 — Attach E2E evidence.** Retain assertions, sanitized correlated artifacts, coverage, and bounded flushing; delegate process startup to existing tooling.
- [ ] **P07-T08 — Exercise failure cases.** Run authorization, cursor/path attacks, sentinel redaction, malicious logs, rotation, overload, restart, remote disconnect, and ownership acceptance.
- [ ] **P07-T09 — Review support claims.** Update generated human/agent guidance and evidence records. Mark unavailable production integrations pending instead of substituting simulated success.

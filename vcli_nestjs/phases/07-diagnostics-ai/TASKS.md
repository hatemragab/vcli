# Phase 07 tasks

**Status: Implementation/local evidence recorded.** Checked items identify implemented source and their named local checks, not blanket provider/deployment acceptance. Selected local/restricted-remote source and named local failure tests passed; native Vector/Logdy/MCP passed84 transforms and15 stages. The fresh generated HTTP/PostgreSQL joined gate passed two tests and six live stages through retained evidence, Vector, MCP and the private viewer. Stronger isolation profiles are unsupported, not advertised as tested. See [status](../STATUS.md) and [acceptance](ACCEPTANCE.md).

- [x] **P07-T01 — Confirm contracts.** Map API/worker/database/infrastructure sources; record event/filter schemas, bounds, versions, transports, and profile trust boundaries.
- [x] **P07-T02 — Extend logging/context.** Reuse foundation logging, propagate approved async/job/run context, and preserve infrastructure parse/source observations without private payloads.
- [x] **P07-T03 — Generate collector/viewer recipes.** Add Vector/Logdy configuration, dependencies, private bindings, examples, setup guidance, and customization-safe transforms.
- [x] **P07-T04 — Implement retained local evidence.** Add rotated JSONL, bounded reader queries, scoped cursors, expiration, drop reporting, and owned-evidence retention cleanup.
- [x] **P07-T05 — Implement read-only MCP.** Validate queries, authorize project/environment/run access, return data-only results, and exclude path/shell/SQL/Docker/deploy operations.
- [x] **P07-T06 — Enforce access profiles.** Separate collector/viewer/reader privileges; document same-user limits, test stronger isolation, and declare remote credential/network needs independently.
- [x] **P07-T07 — Attach E2E evidence.** Retain assertions, sanitized correlated artifacts, coverage, and bounded flushing; delegate process startup to existing tooling.
- [x] **P07-T08 — Exercise failure cases.** Run authorization, cursor/path attacks, sentinel redaction, malicious logs, rotation, overload, restart, remote disconnect, and ownership acceptance.
- [x] **P07-T09 — Review support claims.** Update generated human/agent guidance and evidence records. Mark unavailable production integrations pending instead of substituting simulated success.

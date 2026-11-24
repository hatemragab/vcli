# Phase 02 tasks

**Status: implemented locally for the private Linux bootstrap profile.** See [per-ID evidence](../../docs/CLI-VERIFICATION.md#phase-acceptance-mapping). Read the [design](README.md), [acceptance record](ACCEPTANCE.md), and [status board](../STATUS.md). Execute in dependency order.

- [x] **P02-T01 — Specify resolution.** Define recipe metadata, cardinality, deterministic ordering, conflicts, and selection; reject cycles and unknown recipes.
- [x] **P02-T02 — Specify plans.** Include versions, actions, existence/content preconditions, ownership, installation/check phases, and nonsecret structured output.
- [x] **P02-T03 — Implement reconciliation.** Validate desired/realized choices and touched managed/dependency state; block stack drift without scanning unrelated files.
- [x] **P02-T04 — Implement file planning.** Use templates, JSON edits, deterministic registrations, and managed docs; preserve developer modules/custom integrations.
- [x] **P02-T05 — Protect paths/processes.** Validate identifiers, real paths, symlink ancestors, and separate executable arguments before mutations.
- [x] **P02-T06 — Implement preview.** Produce human/JSON plans without writes/installations; make saving a plan an explicit operation.
- [x] **P02-T07 — Implement apply/journal.** Recheck paths, prevent concurrent VCLI writes, stage changes, and record completed/failed phases.
- [x] **P02-T08 — Implement recovery.** Resume compatible work or restore only matching operation-written bytes; preserve editor changes and expose conflicts.
- [x] **P02-T09 — Implement capture.** Supply bounded local capture, awaited typed outcomes, production rejection, and protected inspection without SMTP/network.
- [x] **P02-T10 — Implement generators.** Create scoped skeletons with explicit imports; keep name-only behavior unexposed and visibly unfinished.
- [x] **P02-T11 — Implement checks.** Measure compilation, module visibility, owner boundaries, class/file conventions, and generation safety without fake business assertions.
- [x] **P02-T12 — Exercise failures.** Cover repetition, stale paths, customization, interruption, failed installs, and changed-after-write recovery.
- [x] **P02-T13 — Review handoff.** Report pending integration, preserve Phase 03's capture contract, retain patch ownership, and update reviewed status.

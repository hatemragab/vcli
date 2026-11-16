# Phase 02 acceptance

**Status: Planned. Implementation has not started. No scenario is currently passed.** Use the [design](README.md), [ordered tasks](TASKS.md), and [verification policy](../../docs/VERIFICATION.md).

## Setup and evidence

Create isolated Phase 01 fixtures with explicit developer edits, sentinels, and supported toolchain versions. Use a controlled fake package-manager boundary for failure injection; label it simulated installation evidence. Record revisions, exact commands/status, before/after bytes for relevant paths, sanitized plans/journals, and the named fault point. Real package installation is a separate scenario when required by the declared gate.

| ID | Scenario | Expected behavior and evidence |
| --- | --- | --- |
| **P02-A01** | Add capture mail to a customized project, then repeat. | First addition preserves developer source and registers explicit modules/config/docs; second produces no duplicates. Record the touched-file plan and preserved sentinels. Missing manual consumer wiring remains visibly pending. |
| **P02-A02** | Preview addition, then create a planned new file or edit a touched managed file before apply. | Preview writes nothing. Apply rejects stale existence/content preconditions without overwriting either edit. Retain filesystem comparison, plan, and conflict result. |
| **P02-A03** | Interrupt after a staged source step; separately fail installation after source application. | Journal/state identifies exact progress and pending install/check work. Retry does not duplicate source or claim prior checks passed. Retain fault-injection description and recovery results. |
| **P02-A04** | Modify an operation-written file after interruption, then request recovery. | New bytes survive; only matching operation outputs are eligible for restoration. Result lists the manual conflict and never invokes repository reset or broad deletion. |
| **P02-A05** | Edit desired stack choices without reconciliation; introduce a missing requirement and a dependency cycle. | Generation refuses mismatched realized configuration and reports deterministic resolution errors. No registry-order fallback, invented provider, or user-file inventory is used. |
| **P02-A06** | Submit capture mail in development/test and select it in production configuration. | Submission awaits a bounded `captured` result with no network. Production fails safely. Capture content is absent from ordinary logs; protected fixture inspection can assert the message without exposing a public route. |
| **P02-A07** | Generate a name-only command/controller and a feature consuming an explicitly selected capability. | Unfinished operation is not routed/exposed or advertised as business-complete. Feature imports are explicit; removing the required module import causes a meaningful composition/check failure rather than being masked globally. |
| **P02-A08** | Supply traversal, symlink escape, shell metacharacters, and partial-state fixtures. | Valid data is handled literally; unsafe paths/identifiers are rejected. Damaged installations are diagnosed rather than reported as no-op success. Retain bounded process/filesystem observations. |

## Exit gate

Review every scenario with truthful static, generated-app, simulation, and local runtime evidence. Required failure cases must preserve sentinels and report actionable errors. Verify no auth, SMTP, or later external capability was smuggled into this phase. Confirm capture can support Phase 03 in development and the same lifecycle remains usable by [Phase 09](../09-upgrades-extensibility/README.md). Record unresolved blockers in [STATUS](../STATUS.md); do not check tasks merely because files were generated.

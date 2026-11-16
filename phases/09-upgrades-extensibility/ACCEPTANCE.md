# Phase 09 acceptance

**Status: Planned. Implementation has not started. No upgrade or extension scenario is currently passed.** Use the [phase design](README.md), [task order](TASKS.md), and [verification rules](../../docs/VERIFICATION.md).

## Setup and evidence

Prepare supported old/new release fixtures, customized business modules, a custom integration module, managed-file edits, ignored private configuration, and known package versions. Record original bytes for relevant paths, not a global user-file inventory. Use isolated fixtures and controlled installation/adapter fakes where needed; label simulated evidence. No production data, cloud account, or live deployment is required for this phase's maintenance mechanics.

| ID | Scenario | Expected result and evidence |
| --- | --- | --- |
| **P09-A01** | Preview a supported target upgrade, then apply its ordinary dependency update in an isolated fixture. | Preview has no filesystem/network effects. Apply identifies exact target and separates source, installation, and checks. Retain plan, versions, lockfile diff, commands, and affected contract results; no deployed-patch claim is made. |
| **P09-A02** | Upgrade customized developer modules and regenerate unchanged managed registration/docs; repeat with a managed edit. | Developer bytes and custom integration survive. Unchanged owned output updates deterministically; edited managed content produces a conflict. Retain touched-path before/after evidence and no duplicate registrations on retry. |
| **P09-A03** | Run a named codemod on its supported fixture and an intentionally unsupported shape. | Supported transform preserves its declared invariants; unsupported source is untouched and receives a reviewable manual path. A passing fixture does not advertise arbitrary-source merge support. |
| **P09-A04** | Interrupt source application, fail installation, and edit an already written file before recovery. | Journal/status identifies incomplete phases; retry avoids duplicates. Recovery preserves new edits and restores only matching operation outputs. Retain fault point and exact affected-path results. |
| **P09-A05** | Select an unknown schema, unsupported release gap, or incompatible runtime dependency; edit a driver to imply switching. | Each fails with an actionable compatibility/reconciliation result. No database conversion, credential replacement, feature removal, or silent `latest` selection occurs. |
| **P09-A06** | An engineer adds an alternate adapter against an existing capability, including configuration, typed outcomes, and rejection/uncertain cases. | Registry, adapter/preset, explicit composition, docs, and shared tests suffice without business-consumer changes. Record actual toolkit edits. Fakes establish translation only; production support needs separate provider acceptance. |
| **P09-A07** | Report an advisory affecting a runtime package and copied sensitive source in different fixtures. | Output distinguishes remediation routes and named responsibility, avoids secrets, and marks unknown custom source outside its inventory claim. Record the proposed package update and source/manual patch separately. |

## Exit gate

Review all seven scenarios, including deliberately refused migrations and partial failures. Required checks must identify revision/toolchain, actual outcomes, and remaining manual work. Confirm the policy did not defer earlier security fixes, invent external-plugin scope, or mistake dependency/source recovery for database rollback. Update [STATUS](../STATUS.md) from reviewed evidence; unsupported paths remain unsupported rather than being listed as complete.

# Verification and support claims

**Status: Planned. Implementation has not started.** No compatibility profile, generated application, provider flow, device interaction, or deployment is verified by this planning package. Exact versions, test runner, and executable verification scripts are selected and recorded in Phase 00; command examples elsewhere are proposed interfaces.

Read [PRODUCT](PRODUCT.md), [DECISIONS](DECISIONS.md), [ARCHITECTURE](ARCHITECTURE.md), the selected phase's acceptance register, and [STATUS](../phases/STATUS.md). Evidence supports an identified behavior in an identified environment; it is not a timeless green flag for the product.

## Evidence levels

| Level | What it can establish | What it cannot establish |
| --- | --- | --- |
| Documentation/static | Valid schemas/output, compilation, lint, measured dependency boundaries. | Runtime behavior, persistence integrity, or delivery. |
| Unit/fake contract | Policy, adapter translation, deterministic failure/interleaving under controlled inputs. | Real database concurrency or external provider behavior. |
| Generated application | Actual dependency installation, compilation/build, boot, and exercised application assertions, recorded separately. | Untested providers, client platforms, or deployment topology. |
| Local real infrastructure | Exercised MongoDB/PostgreSQL/service behavior in the declared isolated topology. | Production operation or native-device interaction. |
| Provider/client/device | Actual configured provider acceptance and separately observed client/device outcomes. | Inbox/display/background behavior that was not observed. |
| Deployed/operational | Identified release, services, routing, state, and exercised recovery under the named platform/profile. | Other targets, capacity, restore paths, or security properties not tested. |

Passing with fakes is useful; label it accurately. A provider accepting an email/push request is not proof of inbox/device delivery. A successful build is not a boot or interaction. A healthy container is not evidence that durable state survived redeployment.

## Profile matrix and coverage

Maintain concrete version tuples and separate rows when profiles differ. Initially every row below is **planned/unverified**; recommendations are not owner-approved pins or tested versions.

| Profile group | Required coverage |
| --- | --- |
| CLI/foundation | Supported host/toolchain tuple; source-only init, installation, build/boot, explicit module visibility. |
| Firebase × MongoDB | Real persistence/security contracts plus independently recorded external Firebase-method/client evidence. |
| Firebase × PostgreSQL | Same advertised contracts using its actual constraints and transactions. |
| Local auth × MongoDB | Registration/session/refresh/action lifecycle using real persistence and declared capture/mail evidence. |
| Local auth × PostgreSQL | Same promised invariants with the SQL adapter and reviewed migrations. |
| Realtime | Socket.IO, Centrifugo, and native WebSocket separately; single/multi-instance and admission modes separately. |
| Mail/push/storage | Capture versus SMTP; FCM/APNs purposes and devices; local/AWS/named compatible storage modes separately. |
| Diagnostics/deployment | Local/remote evidence permissions and retention; each Dokploy/Coolify/CapRover topology and artifact/operator mode. |

Exercise the full four-way authentication/database matrix early in Phase 03. Two diagonal examples cannot establish independent selections. Use shared behavior contracts without pretending both databases implement arbitrary queries identically.

For the remaining catalog, combine each recipe's direct acceptance with documented risk-based pairwise coverage. Add security-critical combinations explicitly: cross-instance auth revocation/realtime, account rebind/queued push, private storage/session revocation, platform routing/storage persistence, and diagnostic cross-project isolation. Pairwise coverage alone cannot certify these interactions. Record exclusions and reasons; do not claim an exhaustive Cartesian matrix or silently remove requested variants.

## Required failure evidence

- **Generation:** prove dry run writes nothing; expected-absence/content conflicts reject stale plans; repeated additions do not duplicate wiring; journal recovery preserves subsequent edits. Separate source, installation, and check outcomes. Measure only relevant touched paths, not every user file.
- **Persistence/security:** exercise actual database constraints, concurrent enrollment/refresh/reset/revocation, guarded versions, transaction participation, and uncertain commit acknowledgement. Inspect final durable outcomes, not only mocked method calls.
- **Authentication:** validate JWT rejection/positive controls, strict refresh single-use rotation, token-family scope, stale reenrollment cutoffs, and provider-revocation observation bounds. Under the initial strict profile, unrecoverable ambiguous refresh requires reauthentication; no transparent retry claim is implied.
- **Storage:** verify private access, attempted overwrite, finalization races, integrity/version binding, expiry, and cleanup racing a replacement. A successful upload request alone cannot establish immutable final content.
- **Operations:** `OutcomeUnknown` remains uncertain until reconciled under its operation contract. A timeout is not proof of failure; automatic retry does not establish exactly-once delivery. Migration locks/history require concurrency/failure evidence, not an unsupported exactly-once execution promise.

Use positive controls alongside denials, and controlled faults alongside happy paths. Correlated logs explain assertions; they do not replace them. Missing events cannot establish success or absence of activity when source coverage, ingestion, retention, or flushing is incomplete. Preserve gap/truncation/expiry metadata and sanitize secrets/action links/provider payloads before sharing artifacts.

## Check selection and release validation

For each change, run the smallest checks that establish its affected claim. Pure documentation changes need document/link consistency review, not application builds. Runtime changes need focused relevant tests; generator/template/recipe changes need representative generated-output checks. Broaden only for changed contracts, failures, or unresolved risks.

During authorized implementation, release validation must actually generate representative apps, install declared dependencies, lint/typecheck, run meaningful tests, build, boot, and assert relevant interactions. Consume the intended distributable/runtime dependencies so local source links do not conceal missing package content. Installation, build, boot, and tests have separate results. No heavy CI setup, download, or application execution is authorized by writing this guide.

Follow the execution host's current resource/download policy. The present host's shared memory/container/browser limits are contributor constraints, not universal generated-app defaults. Missing physical-device or platform-host access is a recorded acceptance gap, never simulated as native runtime success.

## Recording completion

Check a task only when its deliverable and task-specific evidence exist. A checked task is not a completed phase. Use `implemented_local` or `external_acceptance_pending` where required external evidence is missing; independent authorized downstream work may continue under its entry conditions. Full verification requires every declared gate for the recorded supported profiles, with required unfinished variants still visible in [STATUS](../phases/STATUS.md).

```text
Phase/task/acceptance IDs and tested claim:
Source/CLI/recipe/runtime revisions:
UTC timestamp; host/environment/topology and dependency versions:
Exact commands, assertions, run ID, and evidence level:
Result: passed | failed | inconclusive | not-run
Sanitized artifact location; source coverage and omissions:
Invalidation/expiry conditions; remaining gaps and next eligible work:
```

Invalidate relevant results after code, configuration/policy, dependencies, provider settings, credentials/authority, topology, or artifact-retention changes. Record freshness requirements for security-sensitive observations; expired artifacts are not reproducible evidence. Never retain private environment contents or secret hashes as a public configuration fingerprint.

# Phase 00 acceptance

**Baseline review recorded.** See [per-ID evidence](../../docs/CLI-BASELINE.md#phase00-review-evidence); later runtime/provider gates remain open. These checks establish a usable design baseline, not running software. Record evidence under [STATUS](../STATUS.md) using [VERIFICATION](../../docs/VERIFICATION.md).

| ID      | Scenario/setup                                       | Required result and evidence                                                                                                                                                              |
| ------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P00-A01 | A reviewer sees only the transferred VCLI package    | They can identify full scope, coding rules, phase dependencies, next task and open decisions. No active document requires a SuperUp path or private chat.                                 |
| P00-A02 | Review REQ-01–22 against phase outputs               | Every requirement has a responsible phase/acceptance path; all auth/database/realtime/push/storage/deployment variants remain visible.                                                    |
| P00-A03 | Review exact initial toolchain and official docs     | One compatible version/module-format/package-manager/test baseline is recorded. Unverified later SDKs have phase deadlines. No unsupported claim that all suggested versions are current. |
| P00-A04 | Walk the example feature and an added mail provider  | Input/output/authorization and ownership are explicit; provider variation does not change business consumers; Nest provider visibility and developer integration are addressed.           |
| P00-A05 | Review each target's API+DB+realtime+release example | A plausible native profile exists with unsupported features and external services named. Artifact feasibility is not mislabeled live deployment.                                          |
| P00-A06 | Review provenance, resources and maintenance         | Licenses/owners/distribution choices are recorded; secrets absent; missing accounts/devices remain pending; host limits and Phase 03 security gate are identified.                        |
| P00-A07 | Read phase entry gates after decision reconciliation | Phase 01 can start without missing essential choices. Later unresolved choices have owner/deadline, not hidden defaults or contradictory rules.                                           |

Exit: all baseline checks needed for Phase 01 pass with review evidence. Actual runtime checks begin in later phases. A document prepared by an agent does not certify its own design decisions as owner-approved.

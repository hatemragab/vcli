# VCLI implementation status

Updated 21 November 2026. **Private CLI `0.1.2` improves project cloning, application-owned versioning, custom migrations and shared AI guidance.** See [the 0.1.2 verification record](../docs/CLI-VERIFICATION.md#private-012-project-lifecycle). The earlier phase rows identify the exact versions and profiles exercised. Hosted-provider, device and live-deployment acceptance remains pending.

The owner first authorized hand-built [reference APIs](../examples/README.md) to review expected output before CLI implementation. Independent MongoDB-only and PostgreSQL-only references have richer native repositories and recorded local acceptance: MongoDB 146 passed plus one optional skip, PostgreSQL 147 passed plus one optional skip, three HTTP/protocol journeys each, and browser/restart checks each. The subsequently authorized CLI has its own packed generated-project and integration evidence below. Reference evidence does not substitute for generator or external acceptance.

| Phase                                                       | Status            | Implemented revision            | Acceptance evidence                                                                                             | Open dependency                                                                    |
| ----------------------------------------------------------- | ----------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [00 — Baseline](00-design-baseline/README.md)               | verified (design) | private baseline                | [Baseline](../docs/CLI-BASELINE.md)                                                                             | Public namespace/distribution policy                                               |
| [01 — Foundation](01-project-foundation/README.md)          | implemented_local | private0.1.0 / 0.1.1            | Identified packed foundation and four-way stack gates                                                           | Other hosts/public distribution                                                    |
| [02 — Generation](02-safe-generation/README.md)             | implemented_local | private0.1.1                    | Engine23, command/customization/saved-plan guards; packed source/install/check separation                       | Maintenance lineage is separately bounded                                          |
| [03 — Auth/database](03-authentication-databases/README.md) | implemented_local | private0.1.1                    | Four-way packed HTTP; native lifecycle/rate suites; real two-process Argon default/max-cost RSS/health controls | Real Firebase four-method/client acceptance and broader measured capacity profiles |
| [04 — Realtime](04-realtime/README.md)                      | implemented_local | private0.1.1                    | Both native shared-ticket/official-adapter gates; packed Socket.IO; real Centrifugo/Redis12 assertions          | Deployed private routing/TLS/Redis topology and real provider identity             |
| [05 — Email/push](05-email-push/README.md)                  | implemented_local | private0.1.1                    | Real loopback SMTP/APNs, controlled FCM, both real native mail/push owner races                                 | Hosted SMTP/Resend/Firebase actions, FCM/APNs and device/CallKit observation       |
| [06 — Storage](06-storage-media/README.md)                  | implemented_local | private0.1.1                    | Both native media stores; packed private local byte flow; bounded AWS/R2 controlled protocol modes              | Live AWS/R2 policy/version/checksum/CORS and browser conformance                   |
| [07 — Diagnostics](07-diagnostics-ai/README.md)             | implemented_local | private0.1.1                    | Vector84 transforms/15 stages; fresh generated HTTP/PostgreSQL joined evidence, MCP and private viewer          | Deployed HTTPS/real remote credentials; stronger isolation remains unsupported     |
| [08 — Deployment](08-deployment/README.md)                  | implemented_local | private0.1.1                    | Real packed image/services32 steps/4 tests; operators38 controlled tests; both native row-and-byte restores     | All live targets/TLS/volume/scale acceptance                                       |
| [09 — Maintenance](09-upgrades-extensibility/README.md)     | implemented_local | private0.1.0→0.1.1 curated edge | Final offline packed46-stage gate: source/install/check/runtime, same-version repair, failure and recovery      | Public distribution; arbitrary historical baselines are refused                    |

Current local evidence is in [CLI verification](../docs/CLI-VERIFICATION.md) and each capability contract. Controlled provider or persistence fixtures are not real provider acceptance. The historical pre-acceptance tarball `c0103c72...` has observed defects and is safely refused by maintenance; it is a different artifact from accepted bootstrap hash `6dd4e68c...`.

## Status meanings

- `planned`: documented, no implementation evidence.
- `in_progress`: active authorized implementation.
- `implemented_local`: code and relevant local checks exist; list remaining external checks.
- `external_acceptance_pending`: required real provider/device/deployment evidence is missing; record resources needed and which independent work can continue.
- `verified`: all declared gates for recorded supported profiles have evidence. List excluded/experimental profiles explicitly. Do not call full scope complete after silently dropping a requested profile.

Use per-profile rows when an aggregate status conceals missing coverage. Deferred target work remains visible. No dates imply a staffing commitment.

## Evidence template

```text
Phase/task/acceptance IDs:
Revision and date:
Implemented deliverable:
Exact commands / test run ID:
Environment and dependency versions:
Evidence level: static | fake | local-integration | provider | device | deployed
Result: passed | failed | inconclusive | not-run
Sanitized artifact location:
Known gaps and affected support claims:
Next eligible work:
```

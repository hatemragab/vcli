# Phase 07 acceptance

**Status: Planned — implementation not started. No scenario has passed.** Use [TASKS.md](TASKS.md) and [verification](../../docs/VERIFICATION.md). IDs identify required future evidence, not results. Each record needs date, revision, profile, versions, executed commands, assertions, sanitized artifacts, coverage, and limitations.

| Evidence ID | Scenario and setup | Expected outcome and required evidence |
| --- | --- | --- |
| **P07-A01** | Trigger HTTP and worker operations using selected real database/infrastructure in an isolated app. | Approved correlation survives. Vector normalizes selected sources, Logdy displays live events, and the reader retrieves retained records. Preserve assertions and source/parse coverage; timestamps alone are insufficient causality. |
| **P07-A02** | Inject controlled sentinel credentials/signed URLs and malicious instructions into test fixtures. | Sentinels are absent/redacted in retained output, viewer, and MCP. Text stays data; embedded commands never execute. Retain sanitized output/tool traces. Raw injected input remains isolated under declared retention. |
| **P07-A03** | Query another project/environment/run, reuse its cursor, and supply traversal paths or executable filters. | Actual authorization denies cross-scope access; validation rejects unsupported input. No raw file, SQL, shell, Docker, generation, test-run, or deployment capability is indirectly available. Retain denial and filesystem/network observations. |
| **P07-A04** | Rotate evidence between pages; expire a run; send oversized/malformed events and over-limit queries. | Results remain bounded. Expired cursors, gaps, parse failures, and truncation are explicit without crashes or private-content disclosure. |
| **P07-A05** | Restart collector/viewer, overload buffers, and disconnect sources or remote backend. | Application assertions finish within declared bounds, without business retries/unbounded queues. Status exposes drops, gaps, delay, unavailable sources, and recovery limits. Preserve measurements. |
| **P07-A06** | Test local same-user and isolated/shared-production profiles with another project's evidence/container. | Same-user execution is not called a sandbox. Stronger claims require denied secret-file, cross-project log/inspect, write, credential, and unauthorized network access. Docker `:ro` or endpoint flags cannot satisfy this alone. |
| **P07-A07** | Run offline local MCP, then a declared remote backend using restricted credentials. | Local queries require no remote credentials/network. Remote access obeys the selected endpoint/scope restrictions. Missing credentials fail safely; no production mutation authority is inherited. |
| **P07-A08** | Fail an E2E assertion while unrelated native services occupy nearby ports; terminate the wrapper. | Capture separates assertion failure from incomplete logs and uses bounded flushing. Only task-owned processes stop; existing services/state survive. Provider acceptance is never labeled recipient observation. |

## Exit gates

Require reviewed P07-A01–A08 evidence for advertised profiles, customization/conflict checks, and actionable configuration errors. Local real-service evidence certifies neither production retention nor stronger isolation. Mark unsupported/pending profiles in [status](../STATUS.md) and [decisions](../../docs/DECISIONS.md). Reviewers must reproduce an explained failure and denied cross-scope query without granting deployment authority. No task passes merely because a tool name, YAML file, or agent rule exists.

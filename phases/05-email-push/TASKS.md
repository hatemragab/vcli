# Phase 05 tasks

All tasks are planned. Read [design](README.md), [acceptance](ACCEPTANCE.md) and [status](../STATUS.md).

- [ ] **P05-T01 — Finalize delivery contracts.** Define mail/push request limits, typed per-recipient/destination outcomes, unknown acceptance, retry ownership, purpose selection and supported profiles. Preserve capture compatibility.
- [ ] **P05-T02 — Build neutral mail rendering.** Move/keep templates, text alternatives, escaping and asset-copy rules outside SMTP. Bound attachments if supported; protect action links from diagnostics.
- [ ] **P05-T03 — Implement SMTP recipe.** Add supported client/config/TLS/timeouts, typed outcome mapping, owned registration/env/docs and local server tests. Distinguish partial acceptance and timeout-after-accept.
- [ ] **P05-T04 — Wire action emails.** Complete local-auth delivery and both Firebase action modes with allowlisted continuation URLs and current client-link setup. Preserve enumeration safety and one-use credential semantics.
- [ ] **P05-T05 — Implement destination persistence.** Add owner-controlled Mongo/PostgreSQL constraints/migrations and atomic binding/token-generation updates. Define switch/logout/revoke rules and safe summary APIs.
- [ ] **P05-T06 — Implement FCM.** Configure independent messaging credentials, routing, bounded batches, typed errors and invalid-token pruning. Document Apple/browser setup prerequisites.
- [ ] **P05-T07 — Implement APNs.** Add ordinary/background/VoIP purpose rules, environments/topics/credential refs and retry/error mapping. Reject conflicting ordinary routing unless explicitly selected.
- [ ] **P05-T08 — Fence asynchronous delivery.** Recheck eligibility, preserve destination generations, bound retries/expiry/concurrency, and record unknown results. Add durable dispatch only where required; no retry inside DB transactions.
- [ ] **P05-T09 — Generate client/setup documentation.** Include action-link handling, token rotation, logout/account switch, Firebase/APNs setup and PushKit/CallKit requirements. No raw tokens in examples.
- [ ] **P05-T10 — Run evidence matrix.** Test both DBs, fake/local mail/provider outcomes, stale races and authorized real SMTP/FCM/APNs/device cases. Record unavailable resources as pending, not supported-by-mock.

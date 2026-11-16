# Phase 04 tasks

**Status:** Planned — implementation not started. All tasks are unchecked. Use [contracts](README.md), [acceptance](ACCEPTANCE.md), [decisions](../../docs/DECISIONS.md) and the [status board](../STATUS.md). Later providers remain in scope.

- [ ] **P04-T01 — Freeze contracts.** Reverify versions; define authenticated audiences, typed events, optional capabilities, payload/queue limits, expiry/revocation bounds and recovery using Phase 03 authority.
- [ ] **P04-T02 — Generate Socket.IO.** Complete gateway/adapter/context, validation, audience routing, acknowledgements/errors, expiry and client example through the safe planner; require no implicit Redis.
- [ ] **P04-T03 — Accept Socket.IO lifecycle.** Exercise sibling connections, refreshed credentials, queued permission changes, idle revocation, limits/backpressure and drain before adding another provider.
- [ ] **P04-T04 — Generate Centrifugo.** Provide service/endpoints/engine/health, key references, grant issuance, authorized proxy admission and outbound publish/disconnect adapters. Verify exact proxy schemas first.
- [ ] **P04-T05 — Accept Centrifugo security.** Exercise static-secret callbacks without client-header forwarding, per-proxy denials, reconnect/expiry, outage and generation fencing. Verify direct grants separately if advertised.
- [ ] **P04-T06 — Generate native WebSocket.** Define the actual wire protocol, browser-compatible one-use admission ticket, pre-auth limits, heartbeat, authorization, errors/backpressure and executable client.
- [ ] **P04-T07 — Prove shared behavior.** Run all three providers with Firebase/local identity and relevant database adapters; reject unsupported capabilities instead of inheriting fictional replay guarantees.
- [ ] **P04-T08 — Accept scale-out.** Implement actual fan-out/engine/shared-ticket mechanisms, load-balancer settings, shared revocation and restart recovery; demonstrate separate-node interactions.
- [ ] **P04-T09 — Connect operations.** Generate conditional config, client-safe settings, readiness/drain and resource/service contracts for deployment. Preserve standalone profiles without undeclared shared infrastructure.
- [ ] **P04-T10 — Close evidence.** Complete acceptance, customized add/re-add, protocol/failure/drain/restart checks and supported cluster profiles; keep unimplemented alternatives and external-pending deployment/client evidence explicit.

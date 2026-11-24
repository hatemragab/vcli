# Phase 04 tasks

**Status: Implementation/local evidence recorded.** Checked items identify implemented source and their named local checks, not blanket provider/deployment acceptance. Source and named local protocol/native/Centrifugo gates passed. Separate deployed API-node/routing/TLS profiles remain pending; unchecked scale/exit items do not erase implemented mechanisms. See [status](../STATUS.md) and [acceptance](ACCEPTANCE.md).

- [x] **P04-T01 — Freeze contracts.** Reverify versions; define authenticated audiences, typed events, optional capabilities, payload/queue limits, expiry/revocation bounds and recovery using Phase 03 authority.
- [x] **P04-T02 — Generate Socket.IO.** Complete gateway/adapter/context, validation, audience routing, acknowledgements/errors, expiry and client example through the safe planner; require no implicit Redis.
- [x] **P04-T03 — Accept Socket.IO lifecycle.** Exercise sibling connections, refreshed credentials, queued permission changes, idle revocation, limits/backpressure and drain before adding another provider.
- [x] **P04-T04 — Generate Centrifugo.** Provide service/endpoints/engine/health, key references, grant issuance, authorized proxy admission and outbound publish/disconnect adapters. Verify exact proxy schemas first.
- [x] **P04-T05 — Accept Centrifugo security.** Exercise static-secret callbacks without client-header forwarding, per-proxy denials, reconnect/expiry, outage and generation fencing. Verify direct grants separately if advertised.
- [x] **P04-T06 — Generate native WebSocket.** Define the actual wire protocol, browser-compatible one-use admission ticket, pre-auth limits, heartbeat, authorization, errors/backpressure and executable client.
- [x] **P04-T07 — Prove shared behavior.** Run all three providers with Firebase/local identity and relevant database adapters; reject unsupported capabilities instead of inheriting fictional replay guarantees.
- [ ] **P04-T08 — Accept scale-out.** Implement actual fan-out/engine/shared-ticket mechanisms, load-balancer settings, shared revocation and restart recovery; demonstrate separate-node interactions.
- [x] **P04-T09 — Connect operations.** Generate conditional config, client-safe settings, readiness/drain and resource/service contracts for deployment. Preserve standalone profiles without undeclared shared infrastructure.
- [ ] **P04-T10 — Close evidence.** Complete acceptance, customized add/re-add, protocol/failure/drain/restart checks and supported cluster profiles; keep unimplemented alternatives and external-pending deployment/client evidence explicit.

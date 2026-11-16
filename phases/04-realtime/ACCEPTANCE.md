# Phase 04 acceptance

**Status:** Planned — implementation not started. Nothing below is reported passed. Read [VERIFICATION](../../docs/VERIFICATION.md), [contracts](README.md) and [tasks](TASKS.md).

Use isolated generated projects, actual protocol clients and accepted Phase 03 profiles. Each result records versions, node identities, limits/enforcement bounds, commands and redacted service/client assertions. Mock tests do not prove real transport behavior. Local acceptance does not certify deployed TLS/routing or every client platform. Release task-owned services/browsers; resource/download rules apply.

| ID | Setup and scenario | Expected result / evidence |
| --- | --- | --- |
| **P04-A01** | Add Socket.IO to customized local-auth output; repeat and boot client. | Complete wiring, preserved edits, no duplicates/hidden Firebase/Redis; planner diff plus real admission/event exchange. |
| **P04-A02** | Connect sibling tabs/installation, refresh credentials, disconnect an old connection. | Valid session/siblings survive; exact old connection/generation alone disappears. Inspect audience state and clients. |
| **P04-A03** | Forge actor/room/channel; queue disclosure then revoke/disable authority; expire idle socket. | No unauthorized mutation/delivery; measured declared bounds, including the documented in-flight limit. |
| **P04-A04** | Saturate queues/payload/rates/counts, stall client, drain and restart. | Bounded resource use, explicit overflow/unfinished outcomes, no fake success/duplicate handlers; resource and lifecycle assertions. |
| **P04-A05** | Start Centrifugo recipe; request grant and connect real SDK. | Only authorized server-assigned subscriptions; private API/key absent from client config; service/admission/publication evidence. |
| **P04-A06** | Forge callback/header; deny connect/subscription/refresh for installed proxy types. | Service static-secret enforcement without forwarded-header override; version-correct denial/retry envelopes and expected SDK behavior. |
| **P04-A07** | Revoke Centrifugo session; repeat cached hints; expire grant; interrupt provider/engine. | Current checks, exact-generation outbound disconnect, no unauthorized hint authority; bounded failure and documented recovery. |
| **P04-A08** | Exercise any advertised direct-grant alternative. | Independently prove audience/purpose/key/expiry/revocation contract. Proxy success cannot certify it; reject unimplemented selection. |
| **P04-A09** | Browser native ws: obtain ticket, authenticate first message, replay/expire ticket and send pre-auth commands. | Single atomic consumption; no custom-header/URL-credential assumption or pre-auth disclosure. Fresh reconnect succeeds. |
| **P04-A10** | Native ws missing heartbeat, malformed/oversized frames and slow consumer. | Actual liveness/error/correlation/backpressure contract; bounded buffers and truthful presence. Capture real frames/control cases. |
| **P04-A11** | Separate instances: admit on one, revoke/publish on another; exercise selected routing/adapter and node restart. | Measured cross-node fan-out, generation revocation/recovery. Identify topology; local event/pubsub calls alone do not pass. |
| **P04-A12** | Shared fixtures across all transports and both identity modes/relevant DB adapters. | Same advertised authority; explicit protocol differences, safe generation, secret exclusion and supported interaction matrix. |

## Exit gate

`implemented_local` requires all three single-instance protocols, negative authorization/lifecycle checks and safe generation. Advertised cluster profiles also require actual separate-instance P04-A11 evidence. Deployed TLS/routing and untested provider/client platforms stay `external_acceptance_pending`. Presence/replay/direct grants need independent implementations and evidence. Record affected failures/unimplemented selections on the [status board](../STATUS.md); downstream deployment consumes only realized accepted service contracts.

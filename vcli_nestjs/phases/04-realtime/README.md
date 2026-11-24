# Phase 04 — Realtime implementations

**Status:** Planned — implementation not started.

This planning baseline proposes complete Socket.IO, Centrifugo and native WebSocket recipes, in that implementation order. It does not claim an implementation or user approval of every recommended detail. Read [START-HERE](../../START-HERE.md), [PRODUCT](../../docs/PRODUCT.md), [ARCHITECTURE](../../docs/ARCHITECTURE.md), [DECISIONS](../../docs/DECISIONS.md), [VERIFICATION](../../docs/VERIFICATION.md) and the [status board](../STATUS.md). Prerequisites are [safe generation](../02-safe-generation/README.md) and the relevant accepted [authentication/database profile](../03-authentication-databases/README.md).

## Outcome and scope

The developer selects a realtime implementation without changing business consumers or being forced into Firebase identity. The generated application exposes executable client examples for its actual protocol, typed publication and authorization boundaries, integration/configuration and failure behavior. Phase 00 reverifies compatible Nest, Socket.IO, Centrifugo, `ws`, client SDK and scale-out adapter versions before implementation; no historic version is a latest-version claim.

All three providers stay in scope. Implement Socket.IO first, then a Centrifugo service and backend bridge, then native `ws`; subsequently prove supported multi-instance profiles. A single-process recipe need not install Redis. Switching an already-customized provider requires a client/backend/deployment migration plan, not editing one runtime flag.

## Shared contract and ownership

Business application operations depend on a small typed publisher and capabilities for authorized admission/audience lookup. Provider SDK instances, sockets, channels and handshake objects stay in adapters. Presence, client commands, acknowledgements and retained replay are separate declared capabilities; an unsupported operation fails clearly. Avoid a universal socket abstraction that silently discards these differences.

An illustrative event carries a generated UUIDv4 event ID, type/schema version and bounded validated payload. Resource revisions are owner-defined where required. Neither UUID order nor a generic `pts` flag establishes business recovery. Durable commands use the same application operations, authorization and operation-specific idempotency as HTTP; the recommended starting profile uses HTTP commands with realtime notifications. Provider receipts distinguish attempted, provider-accepted, unavailable and audience-ineligible outcomes without promising recipient observation or exactly-once delivery.

Phase 03 owns current account/session/installation authority. Realtime stores bounded connection/grant references, session ID, binding generation, permitted audience and expiry. Several tabs/connections may share a session; an old disconnect removes only its exact connection/generation. A user address provides fan-out, not complete multi-device authority. Client-submitted user/room/channel identifiers never establish authorization.

Admission validates current authority before private delivery. Subsequent expiry, bans, permission changes, revocation and account switching have defined enforcement bounds, including idle sockets. Recheck authority at the contract's required disclosure points and fence queued work against obsolete ownership. Define limits for in-flight data already dispatched; do not promise network cancellation after bytes have left the service. Provider outages cannot restore revoked authority.

## Socket.IO recipe

Generate the Nest gateway/module, authenticated context, handshake adapter, event DTOs, errors/acknowledgements, authorized audience routing, timers and client reconnect example. Connection credentials use the selected profile's supported authentication payload; keep them out of query URLs and generic logs. For a refreshed credential, replace/reconnect under the same valid application session rather than treating refresh as account switching.

Declare payload size, event rate, per-user/session connection count, queued bytes, acknowledgement timeout and disconnect/error rules. Validate inbound commands through their application operations. Backpressure has a bounded overflow policy: fail or drop only explicitly advisory events, report the outcome and direct the client to authoritative recovery. No unbounded per-socket queue or success acknowledgement for an unaccepted command.

Single-instance routing uses local registries and durable Phase 03 authority. Multi-instance support requires an actual compatible fan-out adapter, shared invalidation/recovery behavior, tested failure modes and load-balancer configuration. HTTP polling needs appropriate sticky routing; an explicit WebSocket-only profile changes that requirement and must be tested with its client. Redis pub/sub alone does not provide durable revocation, provider recovery or a complete session policy.

## Centrifugo recipe

Generate a separately managed service/configuration, public client endpoint, private server API, health checks, selected engine integration and Nest admission/publication/disconnect adapters. Keep Mongo/PostgreSQL as application/account/session authority; Centrifugo does not create a second product database. Add Redis only when its selected engine/profile or another declared capability requires it.

Recommend backend connect-proxy admission to reuse current Phase 03 authority. The authenticated application endpoint issues a short-lived purpose-bound grant; the service calls a private backend proxy, which validates the grant/current session and assigns authorized subscriptions. Direct connection/subscription JWT grants are an alternate explicitly supported contract with their own expiry/revocation limits. Neither grant is the API access credential; the provider server API key is separate again. Use maintained libraries rather than custom JWT cryptography.

The integration direction is explicit:

| Direction | Responsibility |
| --- | --- |
| Client → application API | Authenticated grant issuance, current session checks and rate limits. |
| Client → Centrifugo | The selected SDK/protocol, bounded connection grant and subscriptions. |
| Centrifugo → backend proxy | Authenticated provider callback with its documented request/response envelope. |
| Backend → Centrifugo server API | Publish, presence if selected, and outbound disconnect commands. Disconnect is not a webhook that Centrifugo must call. |

Use a dedicated static callback secret checked by the backend and separate server API/grant keys. The service supplies the static header; do not also enable forwarding that same header from clients. Restrict callback/server API network reachability and preserve origin validation; origin alone is not identity.

Implement denial separately for each selected proxy type. Connect rejection uses its documented disconnect response, subscription authorization denial its protocol error response, and refresh expiry the refresh-specific schema. Temporary unavailability uses the documented retryable provider envelope; do not answer every callback with a public Nest 401 body or a fabricated success. Phase 00 verifies exact provider schemas/codes, followed by real protocol assertions. Only callbacks used by the selected recipe are exposed.

Specify grant expiry, revalidation, revoked-session disconnect and cross-instance enforcement bounds. Server-assigned channels remain authorized even when a client repeats cached reconnect hints. History/recovery is an optional provider capability, not canonical database synchronization. A best-effort notification profile uses documented REST recovery after missed hints; retained publication needs a separate durable-dispatch contract.

## Native WebSocket recipe

Use Nest's supported `ws` adapter where appropriate and publish an explicit wire envelope: version, event name, bounded payload, request correlation and result/error shape. Native browser WebSocket does not automatically support Socket.IO/Centrifugo protocols or arbitrary custom handshake headers.

Proposed browser admission is a short-lived single-use ticket minted through the authenticated HTTP API and supplied in a bounded initial authentication message. Until atomic ticket consumption and current session/binding verification finish, send no private data and admit no subscription/command. Bound the unauthenticated connection timeout/bytes/count. Keep tickets out of URLs/logs; reconnect obtains a fresh ticket. A cookie-based alternative needs its own origin/CSRF policy, not an assumed header API. Shared ticket consumption is required for multi-instance support; its store need not universally be Redis.

Implement heartbeat/liveness, frame/message limits, per-session counts, bounded sends/backpressure, audience authorization, expiry and correlated errors. Browser/client examples must demonstrate actual admission, command/response and reconnect failure behavior. Optional presence is an implemented capability, not a placeholder returning online.

## Configuration, drain and integration

Conditional configuration includes provider/endpoints/origins, admission/key references, timeouts/limits, authority/revocation bounds, recovery policy and selected scale-out engine. Keep private endpoints and secrets out of frontend configuration. `doctor` separates installed files, valid config, reachable services, exercised admission/publication and provider/native pending evidence.

On shutdown stop admission, mark readiness draining, bound in-flight work, release timers/listeners/owned connections and report unfinished outcomes. Do not convert queue disposal into successful delivery. Client reconnect and repeated startup must not duplicate handlers or revive old generations. Deployment adapters later consume public/private routing, health, resources and persistent/shared dependencies; this phase supplies the service contract rather than claiming production deployment.

Main risks are credential leakage, stale private delivery, unbounded queues, incorrect proxy envelopes and confusing local fan-out with cluster guarantees. Resolve through [tasks](TASKS.md) and [acceptance](ACCEPTANCE.md). Authentication package updates cannot repair an untested transport authorization path automatically; retain supported combination and patch evidence with each recipe.

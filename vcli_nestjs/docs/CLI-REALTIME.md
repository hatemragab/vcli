# CLI realtime runtime and scale contracts

Implemented source selects Socket.IO, native ws or Centrifugo with scale single-instance (default) or cluster. Native ws rejects cluster. Native database/Socket.IO fixture acceptance has since passed on both databases in the coordinator run; the private Centrifugo/Redis gate is recorded separately below. References remain historical read-only inputs.

| Selection                    | Backend pin                                         | Client pin            | Shared mechanism                                                       |
| ---------------------------- | --------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| Socket.IO single             | socket.io4.8.4                                      | socket.io-client4.8.4 | Native current authority; local connections                            |
| Socket.IO Mongo cluster      | @socket.io/mongo-adapter0.4.0; mongodb7.8.0         | socket.io-client4.8.4 | Existing Mongo handle, capped change-stream events, native node leases |
| Socket.IO PostgreSQL cluster | @socket.io/postgres-adapter0.5.0; existing pg8.23.1 | socket.io-client4.8.4 | Existing pool, LISTEN/NOTIFY/attachments, native node leases           |
| Native ws single             | ws8.23.0; @types/ws8.18.2 development               | Browser WebSocket     | Native atomic one-use admission tickets                                |
| Centrifugo single            | centrifugo/centrifugo:v6.10.3; Node fetch           | centrifuge5.8.0       | Native grants/bindings; memory engine                                  |
| Centrifugo cluster           | Same service; external private Redis>=6.2           | centrifuge5.8.0       | Native shared grants/bindings plus Redis engine                        |

The official [Mongo adapter](https://socket.io/docs/v4/mongo-adapter/) and [Postgres adapter](https://socket.io/docs/v4/postgres-adapter/) carry inter-server hints. Each receiving API node rechecks its own recipients before delivery. Private events never bypass current authority through an account-room broadcast. Native membership detects a node missing from transient adapter discovery; incomplete acknowledgements report unknown. Maximum16 API nodes. Socket.IO is WebSocket-only with polling/upgrades disabled, matching its client. Polling/sticky-session mode is unsupported.

Centrifugo's [Redis engine](https://centrifugal.dev/docs/server/engines) supplies service fanout; memory engine remains single-instance. No app Redis SDK or custom broker is generated. Shared authority stays in the selected database. Shared filesystem/staging and other feature cluster guarantees remain the enclosing deployment's responsibility.

## Composition and source manifest

The factory createRealtimeRuntime(config,authority,events,database) requires a fourth selected native handle, MongoDatabase or PostgresDatabase. Return shape stays module/publisher/attach(server)/close(). Its configured module explicitly exports RealtimeService and the selected protocol service; consumers must import that module. Adapters never end the shared native pool/connection.

The explicit schema/release command calls initializeRealtime(database):Promise<void> from src/modules/realtime/initialize-realtime.ts. Startup calls only RealtimeStoreService.assertInitialized(). Initializer assumes the selected identity foundation created ref_migrations. It creates vcli_realtime_records and selected indexes, marker realtime-v1 and, only for Socket.IO cluster, the native adapter auxiliary collection/table: Mongo capped4MiB vcli_socket_io_events or PostgreSQL vcli_socket_io_attachments (official cleanup). No opposite-provider schema, SQL asset import or runtime DB selector exists.

The realtimeFiles manifest emits:

- Common core/realtime: event-publisher.ts, realtime-store.ts.
- Common modules/realtime: realtime.service.ts, realtime-ticket.service.ts, realtime-records.ts, protocol-validation.ts.
- Selected native modules/realtime: realtime-store.service.ts, initialize-realtime.ts.
- Socket.IO: socket-io.service.ts; cluster adds socket-io-cluster.service.ts and selected native configure-socket-io-cluster.ts plus initialize-socket-io-cluster.ts.
- Native ws: native-ws.service.ts.
- Centrifugo: centrifugo-api.service.ts, centrifugo-connection.service.ts, centrifugo-proxy.controller.ts.
- Generated configured realtime.module.ts, scaffold realtime.controller.ts and the selected clients/*.mjs.
- Centrifugo assets: ops/centrifugo/config.json, compose.yml, README.md and service-requirements.json.

Directly injectable services remain flat. RealtimeTicketService takes authority/ttlSeconds/store; CentrifugoConnectionService takes authority/tickets/store/api/proxySecret; SocketIoService takes config/authority/registry/optionalCluster; NativeWsService takes config/authority/tickets/registry; SocketIoClusterService takes store/configureOfficialAdapter/maxPayloadBytes. The generated adapter closure receives the existing native database.

App env remains REALTIME_PATH, REALTIME_MAX_PAYLOAD_BYTES (max65536), REALTIME_TICKET_TTL_SECONDS (max30), and selected Centrifugo API URL/key/proxy secret. Scale is a generation choice. Only the cluster service env adds CENTRIFUGO_ENGINE_REDIS_ADDRESS. The schema1 service descriptor records image, engine, external Redis requirement, public8000 WebSocket, private9000 API/health, and private backend connect/refresh callbacks. O0 consumes service requirements; rendering never provisions or starts them.

## Authority, bounds and outcomes

Every connection/grant reference retains accountId/sessionId/installationId/installationGeneration/expiresAt. Rechecks compare all authority fields and only shorten original expiry. Tickets contain32 random bytes and only their hash is stored. A native DELETE RETURNING or findOneAndDelete atomically consumes a valid purpose/expiry once across nodes; a wrong-purpose attempt cannot redeem the intended purpose. Native transactions enforce512 outstanding tickets, four/session, ten issues/session/minute and512 active rate buckets globally. In-flight ticket operations cap16 per API node. No production memory fallback exists.

Socket.IO/ws cap128 connections and eight/session per API node,32 pending admissions,60 inbound messages/minute, eight concurrent publications and64KiB advisory buffers. Native admission times out3s and heartbeat runs15s. Socket.IO uses volatile WebSocket sends and disconnects refused sends. Centrifugo caps128 connections/service node,16/provider user and64KiB queue; shared native bindings cap128 total and eight/session across API nodes. API node leases cap16 and expire5s. Node clocks must be synchronized.

Local idle sweeps run every1s with2s authority deadlines: on a responsive event loop, stale Socket.IO/ws connections close within3s. Cutoff invalidation never depends on a transient event. Centrifugo references lease10s and refresh grants expire within5s; sweeps recheck bindings in parallel. Native/provider latency adds to disconnect time. Total callback/network outage may leave a silent provider socket alive during retry; no hard socket-close deadline is claimed then. Every private publication still fails closed. Bytes already dispatched cannot be recalled.

Outcomes are attempted (local socket enqueue attempted), provider-accepted (Centrifugo API accepted), audience-ineligible, unavailable and unknown. Unknown covers incomplete cluster fanout or provider timeout/transport/malformed/temporary acceptance ambiguity. None proves observation, durability, exactly-once delivery or synchronized application state. Event IDs are correlation, not automatic deduplication; clients recover authoritative REST state after admission/reconnect/missed hints.

Consume ambiguity never reuses a ticket. Restarted API processes can refresh shared Centrifugo references. Drain closes local registries, sockets, listeners and timers; Centrifugo aborts outgoing requests and stops admission/publication. The external service owns its sockets, so another API may continue valid shared bindings. Client examples expose idempotent close and remove handlers. Presence/replay/direct-JWT/subscription-proxy alternatives are unimplemented selections.

## Exact Centrifugo private protocol

The [v6.10.3 proxy schema](https://github.com/centrifugal/centrifugo/blob/v6.10.3/internal/proxyproto/proxy.proto) governs this pin. Connect denial is HTTP200 disconnect4501; temporary failure is error100. Refresh denial is HTTP200 result.expired:true. Refresh retry is HTTP503: the pinned schema states JSON error/disconnect fields are ignored, while failed HTTP requests retry. Controlled tests check backend contracts; the private provider follow-up below executes the pinned service and its real retry timer. The [proxy docs](https://centrifugal.dev/docs/server/proxy) describe static service headers and separate callback types.

The backend checks the bounded X-Centrifugo-Proxy-Secret using constant-time hash comparison. Service http_headers/emulated_headers are empty. Client Authorization, Firebase tokens and forged callback headers never forward. API key and proxy secret remain separate and absent from client config. The hashed provider user scopes account/session/installation/generation; disconnect includes this exact user and client. A late old-generation disconnect cannot evict a newly rebound generation. Conditional lease removal also prevents an old sweep deleting a newer refresh.

## Verification and open gates

Worker fixture emission stays under ignored var/cli-realtime and reuses installed SDKs. It does not install, write root dist, start shared services or edit references. Protocol tests use real Socket.IO/ws/Centrifuge clients against finally-cleaned loopback peers. Controlled persistence and Centrifugo wire peers are explicit fakes. Isolated strict compilation covers both native source sets with installed SDKs; this is separate from real database/provider/deployment evidence.

Run node --test --test-concurrency=1 test/realtime-scale-runtime.test.ts test/realtime-scale-selection.test.ts test/realtime-scale-native.test.ts. Native tests require TEST_REALTIME_MONGODB_URL or TEST_REALTIME_POSTGRES_URL, or TEST_DATABASE_URL with TEST_DATABASE_KIND. Missing URLs skip, never fall back. Dedicated DBs need the identity migration foundation. Native cases initialize twice, race32 consumers across handles, fence stale generation/lease removal, exercise official fanout between two runtime instances and revoke both clients.

Final worker commands/results are appended after checks. Packed/generated install/build/HTTP and separate-process native fanout/outage/restart remain root-owned; the private Centrifugo/Redis follow-up below is separate provider transport evidence with controlled authority. Real Firebase/device and deployed routing acceptance remain pending unless separately recorded.

## Worker check record — 17 November 2026

The final focused run used node --test --test-concurrency=1 test/realtime-scale-runtime.test.ts test/realtime-scale-selection.test.ts test/realtime-scale-native.test.ts:24 passed, zero failed, two skipped for absent native URLs. Runtime13 includes real Socket.IO/ws clients, actual Centrifuge5.8 SDK against a controlled wire peer, private HTTP API controlled responses, late-generation disconnect, callback HTTP503 mapping and lost fanout/discovery. Selection11 covers ten profiles and explicit rejection. The final conditional adapter-schema assertions passed in the selection rerun.

Both native template sets compiled successfully using realtimeFixture('mongodb') then realtimeFixture('postgres') through node --experimental-strip-types, with emitted JavaScript confined to var/cli-realtime. Scoped node node_modules/typescript/bin/tsc --noEmit -p var/cli-realtime/tsconfig.owned.json passed for the renderer and owned tests. Scoped ESLint passed on src/recipes/render-realtime.ts, test/realtime-scale*.ts and each isolated native modules/realtime plus core/realtime source set. Prettier --check passed on owned renderer/templates/clients/Centrifugo assets/tests/documentation; the final selection-test edit was formatted and its noEmit/lint/test rerun passed.

No worker installs, downloads, shared services, Docker, browser, root dist/build, commits, publication or provider/account actions occurred. Root supplied missing SDKs; controlled fakes and isolated compilation are not real native/provider/cluster acceptance.

## Native fixture repair and real private provider follow-up

The raw native fixture now calls initializeSocketIoCluster explicitly twice after initializeRealtime, because only generated cluster source receives the renderer's selected hook. Production bootstrap still performs no migrations. The coordinator reported both native suites passing after this fix, including shared ticket races and actual official Socket.IO adapter fanout between runtime instances. This worker did not start or change either database.

The opt-in provider command is VCLI_REALTIME_PROVIDER=1 node --test --test-concurrency=1 test/realtime-provider.test.ts; node scripts/verify-centrifugo-provider.ts exposes the same runner. Ordinary tests skip this service gate. It requires the reviewed cached image digests and sudo Docker, reuses installed public SDK dependencies and performs no npm installs. The runner copies only its own scripts/runtime/client/config and the finite SDK closure, with no user credentials, home directory, environment files or reference applications.

Reviewed Linux/amd64 compressed manifests:

| Official image                | Digest                                                                  | Compressed bytes |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------: |
| centrifugo/centrifugo:v6.10.3 | sha256:116106f9285e6ee129b77eae956c542889e4a6820edcd556c652dbcced171deb |       28,042,271 |
| redis:7.4.7-alpine            | sha256:b9f6cf0cab55fdd102fd2182deeae150457943d33439d18c6e2fc5666d3228c1 |       17,233,628 |
| node:26.13.1-bookworm-slim    | sha256:18a166e2d50578afe933434857ed2d9059bd1aa398a223e9c89eb4302354f079 |       84,104,018 |

The combined new image batch was129,379,917 bytes, inspected before pulling. The cached Orca image lacked a Node executable, so the official Node image was necessary. Images remain ordinary cached tools; no unrelated cache was deleted. There are no downloaded temporary standalone binaries.

Two Centrifugo nodes each receive128MiB/0.25CPU/64pids, Redis receives64MiB/0.25CPU/64pids and the task runner receives192MiB/0.5CPU/128pids:512MiB combined under the coordinator's576MiB follow-up cap. Every container uses cgroup parent orca.slice, task labels and private internal Docker networks with zero published ports. Callback HTTP binds only the runner's task-network IP. The shared Orca server's networks and routes stay untouched. Runner stdin/stdout carries bounded task Docker control requests through the host script; no Docker socket or Docker CLI is exposed inside the runner.

The actual provider suite covers private API/health versus public WebSocket ports, API-key denial, static callback secret versus forged native/emulated headers, no forwarded Authorization, authorized cross-node Redis publication, client publish/subscribe refusal, wrong-purpose/replayed grants, real refresh and permanent expiry, generation rebind/late disconnect, Redis outage with unknown acceptance and recovery, and fresh-grant selected SDK reconnect/disposal after provider restart.

The refresh retry probe deliberately uses a **controlled callback policy without an application binding**, so the runtime's shorter native-shaped lease sweep cannot preempt the service's timer. Its first refresh returns HTTP503, the actual provider retains the connection and calls back again approximately60 seconds later, and the second reply returns result.expired:true. It carries no private publication and does not claim a real identity/native-database lease. The exact [pinned refresh handler](https://github.com/centrifugal/centrifugo/blob/v6.10.3/internal/proxy/refresh_handler.go) implements this one-minute transport-failure grace; the actual timed result is included in sanitized evidence.

The production callback/ticket/publication classes execute against a controlled neutral PrincipalAuthority and ControlledRealtimeStore elsewhere in this suite. Centrifugo, Redis, SDK WebSocket frames, private HTTP calls and process restart/outage behavior are real. This does not merge the fake authority/store evidence into the coordinator's separate real native database acceptance, or establish deployed TLS/ingress, real identity-provider sign-in, cloud services or device acceptance.

Final follow-up command/result: VCLI_REALTIME_PROVIDER=1 node --test --test-concurrency=1 test/realtime-provider.test.ts exited0, one opt-in test passed with all12 provider assertions, zero failures/skips and72.2 seconds test time. The final HTTP503 retry interval was60,002ms. Sanitized evidence is var/cli-realtime-provider/result.json:24 callbacks,23 correct service-secret callbacks plus one deliberate forged-secret negative, zero forwarded Authorization headers, one injected503 and cleanup:true. Runtime versions were Centrifugo6.10.3/Go1.27.3 and Redis7.4.7; the copied public SDK closure contained36 packages including Centrifuge5.8.0.

The worker reran the ordinary realtime runtime/selection/native suite:24 passed and two missing-native-URL skips, with no database starts. Scoped tsc --noEmit using var/cli-realtime-provider/tsconfig.json, ESLint on the owned script/tests/fixture and Prettier checks passed. Without its opt-in variable, realtime-provider.test.ts skips cleanly. Early attempts exposed private-network namespace setup, the SDK's terminal unsubscribed event and evidence-export ownership/tar handling; all were corrected before the final successful command, and no failed attempt is counted as a pass.

Final label checks found zero task containers and networks; the shared Orca server retained its two original network memberships. Temporary runner SDK copies, isolated compiled artifacts and archive fixtures were removed from the worker-owned directory. Only sanitized evidence/manifests and ordinary downloaded image caches remain; no unrelated cache, user content or service was removed.

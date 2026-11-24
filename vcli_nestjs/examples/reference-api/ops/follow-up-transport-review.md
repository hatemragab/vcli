# Strict test typing and transport review follow-up

Historical review report: the original reader path below is now `src/modules/diagnostics/diagnostic-reader.service.ts`, exporting `DiagnosticReaderService`. The recorded commands/results retain their original paths and do not verify the later simplification.

This is source/static evidence for the hand-built expected-output reference, not generator completion or external-service acceptance. The worker made no installs, builds, service/browser launches, commits, pushes, provisioning or deployment actions.

## Exact changes

- `test/realtime-protocol.test.ts`: imported the coordinator's unchanged `./helpers/once-socket.ts` and replaced the six Socket.IO event waits with `onceSocket(socket, event, 3000)`. Native ws and HTTP-server waits still use Node `events.once`; no casts or compiler relaxations were added.
- `src/modules/diagnostics/adapters/local-diagnostic-reader.ts`: fixed a real concurrency bypass. `status()` performed filesystem snapshots outside the existing `active` limit, so repeated MCP `diagnostics.status` calls could create unbounded concurrent reads. Status now shares search's two-operation limit and releases its slot in `finally`, returning the existing safe `DIAGNOSTICS_BUSY` code on saturation.
- `test/diagnostics-reader.test.ts`: added a regression covering status blocking search, search blocking status, capacity recovery after successful operations, and capacity recovery after rejected filters. This test is typechecked and ready for the coordinator's runner; it was not executed by this worker.
- `docs/operations.md`: documented the shared status/search limit and safe saturation result.
- `ops/follow-up-transport-review.md`: this report.

## Focused source findings

- Callback routing is consistent: the delivered Centrifugo config uses `/api/realtime/centrifugo/connect` and `/refresh`; Nest's controller contributes `realtime/centrifugo` and the coordinator's app prefix supplies `/api`. Connect/refresh validate the documented JSON/websocket proxy fields. Their success, disconnect and refresh-expired envelopes match the official proxy contract.
- The private API URL is a prefix, documented as local `http://127.0.0.1:59000/api`. The adapter appends `/publish` or `/disconnect`, uses `X-API-Key`, and exact-client disconnect includes both user and client. The separate internal port, HTTP API key environment setting and Compose callback static-header environment settings match the pinned configuration model.
- Both configured callbacks leave `http_headers` and `emulated_headers` empty. The independent secret comes from `client.proxy.{connect,refresh}.http.static_headers`; client headers cannot replace it through the delivered allowlists. Backend callbacks check the actual header with a bounded, timing-safe hash comparison and ignore body header lookalikes. Private ingress restrictions remain operator setup requirements.
- Centrifugo admissions/refreshes and private HTTP calls have explicit concurrency limits; private replies have a 4 KiB limit, a two-second fetch timeout and rejected redirects. Registry, admission, ping and native-ws send paths have bounded counts/buffers and cleanup of timers/connections; runtime shutdown closes the registry, ticket vault, selected adapter and diagnostics. An authority deadline stops waiting, but does not cancel an underlying authority/database request; cancellation is not claimed.
- Publisher results remain truthful: Centrifugo acceptance requires successful HTTP plus a parsed `result` and no `error`. Failed/malformed/oversized/unknown responses report unavailable without retries. Socket.IO/native ws report attempted dispatch; none of these results proves client receipt or durable replay. No transport source change was needed for the reviewed Centrifugo contracts.
- MCP stays fixed-scope, local same-user stdio with five read-only tools, strict filter schemas, safe error-code mapping, authenticated scoped cursors and bounded pages. The status concurrency bypass above was the concrete defect repaired. No isolation, arbitrary filesystem access, remote transport or mutation capability was added.

Official source comparison used [Centrifugo proxy schemas/header precedence](https://centrifugal.dev/docs/server/proxy), [server API paths/envelopes](https://centrifugal.dev/docs/server/server_api), and [pinned v6.10.3 configuration types](https://github.com/centrifugal/centrifugo/blob/v6.10.3/internal/configtypes/types.go), with Context7 queries for the proxy/API details. This review does not execute or certify the service.

## Checks actually run

All commands ran from `examples/reference-api` using installed dependencies:

- `npm run typecheck:tests`: exit 0; all tests/scripts included by `tsconfig.test.json` typecheck against the current compiled app declarations.
- `node_modules/.bin/eslint test/realtime-protocol.test.ts test/diagnostics-reader.test.ts src/modules/diagnostics/adapters/local-diagnostic-reader.ts`: exit 0.
- Scoped `prettier --write` and `prettier --check` over those three TypeScript files and `docs/operations.md`: exit 0.
- TypeScript Compiler API check loading the actual `tsconfig.json` options with the changed reader source as entry point, transitive imports and `noEmit: true`: exit 0. This checks the changed source independently of the existing compiled declarations and emits no application output.

The coordinator owns runtime rebuilding/execution of the new reader regression. External Centrifugo SDK/service/header-precedence/expiry/outage evidence, Vector/Logdy execution, deployed ingress/TLS, provisioning and platform acceptance remain pending; no additional local HTTP, socket, browser or database journey was run by this worker.

# Native postgres reference verification

Verified locally on 16 November 2026 using Linux x64, Node 26.13.1/npm 11.20.0 and PostgreSQL 16.16. This is the independent hand-built expected-output application. It does not establish CLI generation or complete any generator phase.

## Current acceptance

| Command or check                                                          | Result                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent `npm ci --offline --ignore-scripts --no-audit --no-fund`      | Passed with 510 cached packages; the other database SDK is absent.                                                                                                                                          |
| `npm run build`                                                           | Passed, including selected-database and acyclic architecture prebuild gates.                                                                                                                                |
| `npm run check`                                                           | Passed formatting, lint, source and test/script typechecks, database isolation and architecture checks.                                                                                                     |
| `DATABASE_URL=<private local URL> node scripts/migrate.ts`                | Passed twice against the same disposable database; all four schema owners initialized.                                                                                                                      |
| `TEST_DATABASE_URL=<private local URL> REFERENCE_TEST_SMTP=true npm test` | 148 declared tests: **147 passed, zero failed, one optional native Vector/Logdy skip**. All real-database suites ran.                                                                                       |
| Same isolated configuration, `npm run test:e2e`                           | **Three passed, zero skips**: real HTTP auth/ownership/private media, Socket.IO notification/revocation and native WebSocket one-use admission/replay/revocation.                                           |
| Playwright MCP workbench and OpenAPI                                      | Login 200, note creation 201, owned list 200, cleared credentials 401, masked credentials in tab memory, no localStorage entries, Swagger rendered. No application JavaScript errors; harmless favicon 404. |
| Stop/restart demo against retained disposable data, then Playwright       | Existing fixture login 200; list 200 contains the note created before shutdown. No reset or verification bypass.                                                                                            |
| `npm run check:database`                                                  | 510 locked packages and 127 source files; rejects opposite SDK/source/config, runtime DB selection, old adapters and application memory recipes. **51 positive/negative fixtures passed** in the suite.     |
| `npm run check:architecture`                                              | 127 files / 470 imports / 13 features; runtime/type file and feature graphs acyclic. Negative fixtures reject cycles, forwardRef, locators, global modules and hidden loading.                              |

The suite covers the richer inherited repository methods, selected/partial views, bounded stable pagination/iteration, atomic batches, shared transactions, one-use credentials/refresh, rollback, authority/session fencing, media/push persistence and startup/listener cleanup. Provider policy fakes remain explicitly separate from real database behavior. Local SMTP used actual Nodemailer against a task-owned TCP peer; it does not prove hosted mail or inbox delivery.

PostgreSQL regressions include native SQL joins/grouping, explicit conflict-target upserts, useful caller-owned row locks, primary-key eligibility, JSONB/date/array/bigint column codecs and unknown commit acknowledgement without unsafe replay. Each suite creates and removes only its generated private schema.

The optional live-feed test was skipped in this final suite because reviewed Vector/Logdy binaries were no longer present. The completed parallel logging task separately passed native Vector 0.62.0 transform tests and a real Logdy 0.17.1 loopback feed, including retained logging after viewer shutdown. Its exact commands, limits, release checksums and focused source fingerprint are preserved in [the logging record](VERIFICATION-HISTORY.md#shared-logger-verification--16-november-2026). This does not establish Compose/host-gateway topology or viewer browser/deployed acceptance.

## Evidence and cleanup

Sanitized command logs, versions, browser/restart outcomes and source manifests are retained in the repository's ignored `examples/reference-api/var/native-acceptance/`, with separate `mongodb-*` and `postgres-*` records. Cached images/packages were reused; no download was required for this native acceptance. The two resource-limited database containers ran serially with private networking and no published ports. Both task containers/anonymous volumes, preview terminals, temporary credential files and the Mongo relay were removed/stopped; Playwright was closed. No production services, provider provisioning, publication, commit, push or deployment occurred.

The reviewed source is uncommitted over planning base `41797798fdd585fedb0ddf0b29cb755e226ddf63`. The current public source/config/test/operations fingerprint is **`69bad58f3b3d3cc0291a27e12e54020a1a3d41a4e27d84271cc4c2b77930ae67`**, covering 196 files. Algorithm: SHA-256 of sorted relative filename, NUL, bytes, NUL. Markdown, screenshots, private env, dependency/build output and runtime data are excluded. The per-file manifest is retained with the command evidence.

[Earlier verification and scoped parallel logging records](VERIFICATION-HISTORY.md) retain their original evidence and fingerprints; earlier combined-database/memory results do not verify this native implementation. See [the actual tree](PROJECT-TREE.md), [walkthrough](CODE-WALKTHROUGH.md) and [repository contract](base-repository.md).

## Remaining acceptance and scope

Real Firebase email/password/phone/Google/Apple sign-in, hosted SMTP/domain/inbox, AWS/R2 provider conformance, FCM/APNs provider/device delivery, Centrifugo service, container image execution, Vector/Logdy container/viewer topology, Dokploy/Coolify/CapRover deployment and backup/restore require separate configured resources and evidence. No test double substitutes for these results.

This reference remains single-instance and uses mediated transfers. Arbitrary custom S3, presigned/multipart uploads, durable outbox/replay, automatic abandonment of uncertain finalization, stable installation reuse/rebind, account link/unlink/deletion and application-delivered Firebase action-link workflows are unsupported or unfinished here. Remote/strongly isolated diagnostics, worker/database/infrastructure collection and an MCP test-result tool need their own implementation. These limits do not remove requirements from the authorized CLI implementation plan.

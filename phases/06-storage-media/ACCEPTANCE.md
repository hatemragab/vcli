# Phase 06 acceptance

**Not run.** Record each profile separately under [STATUS](../STATUS.md), following [VERIFICATION](../../docs/VERIFICATION.md). Local emulation is not hosted-provider evidence.

| ID | Scenario/setup | Required result / evidence |
| --- | --- | --- |
| P06-A01 | Add each storage recipe to customized app; repeat/preview | Correct selected wiring/config/docs; preserved user source/private values; idempotent repeat and zero-write dry run. Unsupported profile requirement fails before mutation. |
| P06-A02 | Another account submits owner/object/path fields or asks for a download | Ownership comes from trusted context; private media inaccessible, no arbitrary object-key selection or existence leak. Both DB adapters pass. |
| P06-A03 | Oversized/slow/aborted streams and parallel initiations exceeding quota/attempt limits on both databases | Atomic reservations bound outstanding grants/bytes; completion/expiry/failure accounting is idempotent. Memory/time/concurrency remain bounded; actual pre-transfer enforcement is documented per provider; cleanup is safe and recoverable. |
| P06-A04 | Wrong size/checksum, false MIME/filename, unknown ETag semantics | Finalization rejects unsupported or failed evidence; no MIME/scanning claim from metadata alone; quarantined content cannot become ready without required checks. |
| P06-A05 | Replay same upload grant after finalize; issue competing attempt | Previously committed bytes remain unchanged through enforced condition/version/promotion. Unique keys alone do not count as proof. Test each advertised mode/provider. |
| P06-A06 | Multipart part replacement, conflicting completions, lost completion ack | Exact committed object evidence is reconciled; one application result, no changed ready bytes, no blind retry or assumed initiation condition. |
| P06-A07 | Provider completion succeeds, DB commit fails; retry/concurrent finalizer | Durable state recovers original object/transition or reports unknown; no fake ready state, duplicate media or unsafe orphan cleanup. |
| P06-A08 | Traversal/encoded path, symlink/ancestor race, active HTML/SVG download | No escape/read/write outside private root; safe exclusive operations; attachment/nosniff and origin policy prevent active content on app origin. |
| P06-A09 | Logout after download/upload grant; use before/after expiry | Declared grant lifetime/independence holds; no false instant-revocation promise; mediated profile if required is separately tested. |
| P06-A10 | Delayed delete/expiry cleanup after replacement; repeated abort/delete | Generation-bound cleanup cannot delete committed replacement; retries remain bounded; partial provider failures remain visible. |
| P06-A11 | Browser-like upload with actual signed headers/CORS to AWS and named compatible store | Supported single/multipart/conditional/checksum behavior proven with SDK versions/date; provider incompatibility does not silently disable security checks. |
| P06-A12 | Restart app/volume; inspect logs/evidence and deployment requirements | Required files persist within declared topology; signed URLs/credentials absent from diagnostics; multi-instance local-disk limitations documented and enforced. |

Local exit: `implemented_local` after application, real-DB and local-file acceptance. Required live storage profile evidence remains `external_acceptance_pending` until measured. Full verification includes AWS and the named S3-compatible profile with all advertised modes; arbitrary endpoints are not certified by configuration alone.

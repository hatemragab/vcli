# Phase 06 — Storage and media

**Status: Planned — implementation not started.** Provider semantics and live compatibility must be verified before any support claim.

Read [START-HERE](../../START-HERE.md), [PRODUCT](../../docs/PRODUCT.md), [ARCHITECTURE](../../docs/ARCHITECTURE.md), [DECISIONS](../../docs/DECISIONS.md), [VERIFICATION](../../docs/VERIFICATION.md), [TASKS](TASKS.md), [ACCEPTANCE](ACCEPTANCE.md) and [STATUS](../STATUS.md). Depend on Phase 02 installation and Phase 03 account/persistence authority. Neither realtime nor push is required.

## Outcome and scope

Generate a private media workflow with local filesystem, AWS S3 and one named verified S3-compatible profile. R2 is the proposed compatibility stress case; selection and exact SDK/API behavior require review. Arbitrary custom endpoints may be configurable but are unverified until their required operations pass the conformance suite.

Business consumers use small application capabilities such as begin upload, finalize upload, authorize download and delete media. Provider-facing object reading/writing/transfer capabilities live behind adapters. Do not expose S3 SDK commands or a giant storage interface to every consumer. Local uploads can stream through the API while S3 uploads go directly to object storage; identical client mechanics are not required to preserve the application contract.

Proposed commands: `vcli add storage --driver local` or `vcli add storage --driver s3 --profile aws`. An explicit named compatibility profile supplies endpoint/signing/addressing/client behavior and declared guarantees, not just a URL.

## Media and attempt records

Separate a logical media record from each upload attempt. The record owns account/resource authorization, intended purpose, status, public UUIDv4 identity and immutable committed-object reference. Attempts contain generated object key, storage profile/bucket reference, expected size/type/integrity policy, expiry, state, multipart reference if used and completion evidence. Caller filenames are display metadata, never filesystem paths or trusted MIME evidence.

Suggested states are `pending`, `ready`, `rejected`, `expired`, `deleting`, `deleted`; attempts may also be `uploading` or `finalizing`. Define legal transitions and optimistic generation/compare-and-set conditions. Only an authorized successful completion transitions the media to ready. Concurrent finalizers return the same committed reference or a typed conflict; no request selects another owner's object key.

Mongo/PostgreSQL adapters implement equivalent ownership, generation, uniqueness and transition contracts. Logical expiry is checked on use. Background cleanup is bounded and idempotent, never a security boundary dependent on TTL timing.

## Upload lifecycle

1. **Initiate:** authenticate current authority; validate purpose, allowed declared media types, byte limit, quota and active-attempt count. Create a unique attempt and issue only the permitted transfer instruction with an expiry. Never issue general bucket credentials.
2. **Transfer:** local mode streams to a private temporary location with byte/time limits; object mode uses a verified presigned or multipart mechanism. Enforce limits before/during transfer where supported. If a provider cannot enforce the required pre-upload size bound, declare that gap and choose an approved bounded proxy/POST-policy route or reject the profile. Post-upload HEAD rejection alone does not prevent bandwidth/storage abuse.
3. **Complete:** recheck current owner/attempt authority, verify actual object identity, size and the selected integrity evidence; finalize the provider operation under the correct condition, then atomically commit the immutable reference. Do not accept client claims as evidence. Unknown provider completion is reconciled before retry.
4. **Read:** authorize the media at request time and issue a bounded download capability or controlled stream pinned to the committed bytes/version. Private-by-default remains true after upload.
5. **Abandon/delete:** revoke application access, abort pending multipart where supported, and perform retryable cleanup with exact generation/reference. A delayed delete cannot remove a later replacement object. Retention/legal policies are explicit product inputs.

Provider calls are outside retryable database transactions. Durable attempt state records intent and recovery facts. A provider success followed by DB failure leaves recoverable/orphaned state, not a fabricated successful media record. Cleanup never deletes arbitrary prefix contents based solely on caller input.

Quota and active-attempt limits require atomic reservations or equivalent guarded accounting; a read-only check before issuing concurrent grants is insufficient. Bound outstanding grants and reserved bytes on both databases. Completion converts reserved usage to committed usage; failure/expiry releases it idempotently only when the transfer/grant lifecycle permits. Unknown provider outcomes do not justify prematurely freeing an active reservation.

## Finalized bytes must stay immutable

A unique random attempt key avoids collisions but does not prevent replaying the same still-valid upload grant against that key. Choose and prove one supported strategy:

- Enforced conditional object creation and conditional multipart completion, with required conditions bound to grants/server requests and no overwrite path left to the client.
- A provider version identity recorded at finalization and pinned on every later read/download, where real versioning is supported.
- A reviewed provider-side staging/promotion strategy that binds the verified source bytes/version and prevents later grants from changing the committed destination.

Prefer the simplest supported strategy. Do not require expensive copying for every provider, but do not reject safe promotion merely because it has a cost. Local finalization must similarly prevent overwrites and path races. A `ready` database flag cannot make a mutable object immutable.

For multipart, the backend controls upload creation and final completion; part grants are scoped to the exact attempt/upload ID/part number with bounded count/size/expiry. Validate the completion manifest and provider-reported part/checksum evidence. A condition on initiation is not assumed to apply at completion. Replaced parts, concurrent completions and lost completion acknowledgements are explicit tests. If the profile cannot uphold the required guarantee, reject that mode or require another strategy.

HEAD metadata can establish reported size/metadata and supported checksums; it cannot prove content safety or MIME type. ETag is not universally a content hash. Define checksum algorithm and full-object/composite interpretation per mode. Where policy needs actual format validation or malware scanning, quarantine until a real validator/scanner succeeds; do not fake the check with filename extensions or client content type.

## Provider profiles

The implemented profile records verified SDK/API versions and date, endpoint/region/addressing, signing/checksum settings, supported single/multipart operations, conditional semantics, versioning, CORS, lifecycle/abort behavior, encryption policy and transfer size enforcement. Consumer requirements are compared with explicit flags/sets; unsupported behavior fails at planning/configuration time.

Do not send AWS ACL/encryption/checksum fields to every compatible endpoint by default. Use current official compatibility docs and dated live tests. A local S3-like server proves only that implementation, not AWS or a named hosted provider. Client SDK default behavior and browser signed-header/CORS requirements are part of the contract.

## Local storage and serving

Store files outside public static roots. Use an application-owned root with private permissions, generated segments and no untrusted path concatenation. Canonicalize paths and reject traversal, symlinks and ancestor escapes; use race-resistant file operations and exclusive destination creation. Do not assume a pre-check alone prevents a later symlink substitution. The threat model assumes the app's storage root is not writable by unrelated users.

Bound streaming request size/time/concurrency and handle disconnect cleanup. Never buffer an entire large upload in memory. Private serving defaults to attachment with a safe filename and `nosniff`; inline user content needs an allowlisted format and separate-origin strategy. HTML/SVG and other active content cannot be served inline on the application origin by default. Provider metadata/response overrides must preserve this policy.

Local persistent files need a declared volume/backup strategy. Multi-instance deployments cannot pretend per-container disks are shared. Phase 08 accepts only verified shared-volume/single-instance profiles or uses object storage.

## Configuration and observable behavior

Conditional configuration covers local private root, provider bucket/endpoint/region/secret references, allowed upload policies, grant lifetimes, limits, cleanup schedules and serving origin. The CLI creates examples and docs; it does not provision a public bucket or copy credentials automatically. Bucket/CORS/lifecycle setup is an explicit artifact/runbook with acceptance checks.

Errors distinguish unauthorized/missing media, expired attempt/grant, quota/size/type violation, failed integrity, conflict/already-finalized, unsupported capability, provider-unavailable and completion-unknown. Public mappings avoid exposing private object existence. Signed URLs and upload credentials are secrets and must not enter normal logs or MCP output.

Application logout does not necessarily revoke an already-issued storage URL. Bound its lifetime, document that independence, and use a mediated access path if the product requires immediate revocation. Cleanup and finalization must tolerate retries without claiming exactly-once execution.

Generate ownership modules, adapter/profile configuration, routes/DTOs, persistence migrations, client request/complete/download examples and tests. Defer transcoding, asset editing, public CDN management and a general data-migration engine unless explicitly requested.

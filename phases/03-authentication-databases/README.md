# Phase 03 — Authentication and databases

**Status: implementation in progress; named acceptance gates remain open.** Planned — implementation not started.

This is a planning baseline for engineering review, not a claim that its proposed policies are user-approved or implemented. Read [START-HERE](../../START-HERE.md), [PRODUCT](../../docs/PRODUCT.md), [ARCHITECTURE](../../docs/ARCHITECTURE.md), [DECISIONS](../../docs/DECISIONS.md), and [VERIFICATION](../../docs/VERIFICATION.md). Follow the [status board](../STATUS.md). The prerequisite is [Phase 02](../02-safe-generation/README.md), including its generated foundation and restricted development mail capture.

## Outcome and implementation order

Generate independently usable authenticated applications with Firebase or local email/password identity and MongoDB/Mongoose or PostgreSQL/Drizzle persistence. Complete Firebase/Mongo first, add PostgreSQL parity second, then complete local authentication against both databases. The final support matrix has four combinations; passing one does not certify another. Firebase email/password, phone, Google, and Apple all remain in scope.

Phase 00 must reverify compatible Node, Nest, TypeScript, Mongoose, Drizzle, database, Firebase Admin, JWT, and password-library versions before implementation. Historic checkout versions are extraction evidence, not purported latest pins. The portable specification requires no SuperUp source or private configuration.

## Architecture and shared security boundary

Generate owner-based account, identity, installation, and session modules with explicit composition and one handwritten class per file. Controllers parse and map; application operations coordinate; domain policies are deterministic; adapters own SDKs and persistence. Small capabilities include principal verification, account lookup, session authorization, credential storage, and revocation. Do not expose vendor documents or generic query escape hatches.

A narrow shared authentication package may centralize reviewed credential validation, token construction/verification, password-library integration, and stable security errors. Use maintained standard cryptographic libraries; do not implement a JWT engine or custom password cipher. Exact package/library choices are recorded in DECISIONS. Shared code cannot supply database atomicity through an unconstrained get/save interface: adapters must implement the required atomic transitions, constraints, and conflict outcomes. Generated wiring, schema migrations, configured policies, and deployed package versions remain security responsibilities.

Generate application UUIDv4 identifiers through an injected boundary; supply IDs/time to pure operations. Firebase UIDs remain external identity references. Public IDs must not expose ObjectId machinery or embed an assumed ordering contract. PostgreSQL UUID columns and Mongo representation may differ internally; both preserve the declared UUID wire shape. Pagination uses a scoped deterministic sort tuple and unique tie-breaker, not UUID order as a synchronization sequence.

## Data and transaction contracts

Keep these concepts distinct even when related records share a transaction:

| Owner data                        | Required facts and invariant                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account / identity binding        | Application ID, active/disabled/deleted state, unique provider/project/subject mapping; local canonical email uniqueness. Never merge identities by matching email text alone. |
| Installation                      | Application/environment/platform, stable installation reference and ownership generation. Claimed installation metadata does not prove hardware identity.                      |
| Session                           | Account, installation/generation, identity method, recent-auth facts, expiry and revocation. Several connections may share one session.                                        |
| Local credential / refresh family | Password hash/version; hashed opaque refresh credentials, family/generation, consumed/revoked state and expiry. Family reuse cannot revoke an unrelated newer login.           |
| Action / provider intent          | Hashed one-use reset/verification token and purpose; durable provider revoke/delete intent with guarded ownership and retry state.                                             |

Notification destinations are a separate ownership contract completed in Phase 05. This phase supplies installation/session invalidation capabilities; it does not invent FCM delivery.

Use an explicit opaque transaction context passed to participating capabilities. One coordinator starts and commits an atomic operation; adapters translate the context to Mongoose or Drizzle handles. AsyncLocalStorage is not mandatory. No ORM handle escapes into domain/public contracts, nested owner commits, parallel transaction statements, or external provider/mail calls inside retryable callbacks. Generate Mongo replica-set requirements for transactional features, PostgreSQL constraints/migrations, and guarded concurrency operations. Never substitute sequential writes while claiming atomicity. Logical expiry is enforced on use; TTL cleanup is housekeeping.

## Firebase authentication contract

The client Firebase SDK performs selected provider sign-in and credential refresh. Backend verification validates issuer/project, signature, expiry, permitted sign-in method, and current disabled/revoked-user authority according to a measured policy. The generated application adds a stable opaque per-session capability, stored only as a hash, to the Firebase ID-token request. Refreshing an ID token preserves an authorized existing application session.

New enrollment requires recent Firebase `auth_time` plus an account enrollment cutoff/generation applicable to revocation. Enrollment and revocation contend on the same durable identity authority; merely checking a timestamp before an unguarded insert is insufficient. Old proof plus a new capability/installation ID cannot undo revocation. Genuine reauthentication can enroll after the documented boundary; still-authorized sibling sessions survive according to revocation scope. Do not use token `iat` as proof of reauthentication.

The strict application method allowlist is checked at bootstrap and current authorization, with a defined invalidation bound after configuration changes. Firebase console method disablement is not magically observable from an otherwise valid old token. Document this limit and the required application policy update; account disabled/revoked checks are separate. Fail closed on unavailable verification without misreporting it as bad credentials. Phone-only accounts may have no email; verified provider phone and editable contact phone are different facts. Provider linking/unlinking needs explicit verified ownership and recovery when removing the last method.

## Local authentication contract

Before implementing local credentials, write the threat model for stuffing/enumeration, secret theft, refresh/reset replay, account linking, hashing exhaustion and key compromise. Use a reviewed Argon2id implementation with parameters checked against current guidance and measured on the supported host profile. Store self-describing hashes and rehash after successful authentication when policy changes. Bound hashing concurrency, password input and request rates without silent password truncation; choose Unicode handling explicitly. Unknown-account login uses the reviewed dummy-verification path and the same public failure shape. Per-account/IP throttling must work across instances in the advertised scale profile. Timing tests use tolerances and do not promise perfect network timing equality.

Provide registration, login, email verification/resend, reset request/confirmation, password change, refresh, safe account/session reads, and revocation. Choose measured password-hashing parameters, identifier normalization, input bounds, throttling, and enumeration-safe responses during implementation review. Short-lived JWT access credentials validate issuer, audience, algorithm, expiry and key identity; current server-session authority is the baseline for independently revocable multi-device access.

Generate opaque session/refresh/action secrets with at least 256 bits of cryptographic randomness; retain only the required hashes/metadata in credential records. JWT key IDs select trusted configured keys, never arbitrary client-supplied key locations or algorithms. Key rotation, compromised-key response, rate-limit-store outage behavior and account verification gating are documented policies, not hidden library defaults.

Refresh credentials are independently random opaque secrets, hashed at rest and strictly single-use. Atomically consume the current credential and create one successor in its existing family. Clients coordinate one in-flight refresh per shared session, including browser-tab coordination where necessary. A lost or ambiguous refresh response requires reauthentication; no retry grace, deterministic secret derivation, encrypted replay cache, or ancestor-driven rotation is promised. Consumed-token reuse revokes only its retained family. A later independent login has a different family and remains intact. Document strict-mode friction instead of pretending hash-only storage can recover the original random successor.

Reset/verification tokens are purpose-bound, expiring and atomically consumed. Specify reset/password-change invalidation and recent-auth requirements. Development actions use Phase 02's restricted capture port; tokens/links never enter generic logs or shared evidence. SMTP delivery is completed in Phase 05. Production capture is prohibited, and production verification/reset readiness remains external-pending until a real configured mail path is accepted. This does not create a cyclic prerequisite on Phase 05 for local development implementation.

## API, errors and configuration

Proposed HTTP operations are Firebase bootstrap; local register/login/refresh; verification/reset request/confirmation; password change; current account; session list; and current/selected/others/all revoke. Exact route names and header/cookie transport are frozen with request/response/error examples before generation. Trusted actor/account comes from verified context, never editable request ownership fields. Lists exclude credentials/hashes and enforce bounded pagination. Browser cookie transport requires explicit secure attributes and CSRF policy; native examples use their declared transport.

Define stable errors for invalid/expired credentials, session revocation, recent-auth required, provider disallowed, duplicate identifier, invalid/expired action, refresh reuse, throttling, and dependency unavailability. Enumeration-sensitive operations use the reviewed public mapping. Return no raw SDK/database errors or secrets.

Conditional schemas require only the selected identity/database settings: connection reference and topology, Firebase project/credential reference/method allowlist or local signing-key references/password policy, session/token lifetimes, trusted origins, and mail policy/capture restrictions. Secret values stay private and out of project selection JSON. Production readiness distinguishes installed code, valid configuration, provider reachability, accepted behavior, and unavailable external setup.

## Integration and risks

[Phase 04](../04-realtime/README.md) consumes current principal/session authority and invalidation; it must not require Firebase when local identity is selected. Phase 05 consumes destination ownership and the mail port. Database changes remain migration projects. Main risks are replay/enrollment races, mismatched adapter guarantees, provider-console misconceptions, refresh response ambiguity, and security patches stranded in copied output. Resolve them with [ordered tasks](TASKS.md), the four-way contract matrix and [acceptance evidence](ACCEPTANCE.md), not broad production-readiness claims.

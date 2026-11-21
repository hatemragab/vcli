# Phase 05 — Email, installations and push

**Status: implementation in progress; named acceptance gates remain open.** This phase completes delivery integrations and evidence; it does not claim SMTP inbox delivery or device notification acceptance.

Read [START-HERE](../../START-HERE.md), [PRODUCT](../../docs/PRODUCT.md), [ARCHITECTURE](../../docs/ARCHITECTURE.md), [DECISIONS](../../docs/DECISIONS.md), [VERIFICATION](../../docs/VERIFICATION.md), [TASKS](TASKS.md), [ACCEPTANCE](ACCEPTANCE.md), and [STATUS](../STATUS.md). Prerequisites: [Phase 02](../02-safe-generation/README.md) capture-mail contract and [Phase 03](../03-authentication-databases/README.md) account/session/installation authority. Realtime is independent, not required.

## Outcome and choices

Generate SMTP application mail and selectable Firebase-managed or application-delivered authentication emails. Add FCM and APNs destinations for multiple installations, including an explicit VoIP purpose. Preserve Firebase and local-auth independence: local JWT apps may use FCM through Firebase Admin without selecting Firebase identity.

Proposed commands are `vcli add mail --driver smtp`, `vcli add push --driver fcm`, and `vcli add push --driver apns --purpose voip`. The actual parser/choice schema must use Phase 02's contract, not introduce aliases silently. Adding providers updates owned registration, environment examples, selected docs and tests, preserving private values and custom code.

## Mail architecture

Separate three decisions:

| Choice                   | Responsibility                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Application mail enabled | Whether business operations may submit mail through an internal capability                                |
| Auth email workflow      | Local action tokens, Firebase-managed actions, or application delivery of Firebase-generated action links |
| Delivery provider        | Development capture, SMTP, or later HTTP implementation                                                   |

Rendering belongs to a provider-neutral mail module. Template selection, HTML escaping, plain-text alternatives, locale/variable validation and asset copying must work without SMTP installed. Do not accept arbitrary client template paths, sender headers or continuation URLs. Business callers depend on small typed submissions; no raw Nodemailer/Firebase response or general public send-email endpoint.

The submission contract includes operation/message identity, approved sender/recipient, template/version and variables or rendered bodies, bounded attachments if actually supported, and provider timeout. Sensitive reset links are secrets, excluded from logs and shared diagnostic output. Capture remains a restricted development/test adapter with production startup refusal.

Outcomes distinguish `captured`, provider `accepted`, permanent rejection, retryable rejection with optional retry-after, and `outcomeUnknown` after possible acceptance. SMTP may accept some recipients and reject others: use one recipient per action email or return per-recipient outcomes for supported batch mail. Accepted means provider acceptance, not inbox placement or reading.

The application dispatcher owns retry policy. An SMTP timeout after possible send cannot safely be treated as unsent; no automatic duplicate suppression is claimed without provider support. Bounded asynchronous delivery uses durable message identity/outbox where required, not an obligatory queue for every project. Repeated dispatch never creates a fresh reset credential merely because a prior send outcome was unknown. Duplicate delivery, when unavoidable, carries the same still-valid operation semantics and is documented.

Durable action-email delivery can retain usable action links even though the credential table stores only hashes. Treat retained delivery payloads as secrets: use an approved protected store or encrypted minimal payload with keys outside the job store, restricted access and bounded retention. Queue/admin diagnostics expose message identity/status, not secret bodies. Clear completed/expired payloads according to policy and include backups/captures in the protection boundary.

SMTP configuration includes host, port, TLS mode, trusted certificate behavior, credentials reference, from address, timeouts and connection limits. Reject insecure certificate bypass in the supported production profile. Use a local test SMTP server for adapter behavior, then an authorized provider/domain for live acceptance. Domain verification, SPF/DKIM/DMARC and relay configuration are setup tasks, not proof created by generating `.env` keys.

## Authentication email integration

Local auth reuses Phase 03 purpose-bound, hashed, one-use, expiring verification/reset actions. Public request responses remain enumeration-safe; internal delivery errors remain diagnosable without exposing account existence. Password changes and token consumption follow their existing invalidation rules.

Firebase-managed mode leaves delivery with Firebase. Application-delivered mode obtains Firebase action links through the supported Admin SDK and sends them via the configured mail provider. Verify current Hosting/link-domain and mobile continuation settings; do not copy deprecated dynamic-link fields from older source. Allowlist continuation URLs and document email action handling on each client. Apple private-relay sender requirements are an external setup item when applicable.

The backend plan includes action handlers/contracts and setup examples, not a full branded frontend. Review redirect safety, expired/used links, mismatched purpose and account linking. Phone-only accounts need no invented email identity.

## Installation and destination model

Keep sessions and installations from Phase 03 distinct from push destinations. A destination records application/environment, installation ID, current account binding/generation, platform, purpose, provider, secret token, token generation, update/last-success times and disabled state. Store provider tokens with restricted access; a hash alone cannot be used to send. Do not log or return tokens through session/device list APIs.

Use a declared uniqueness/deduplication rule for provider/app/environment/token and active ownership. A claimed device ID or push token is not proof of physical-device identity. Authenticated registration derives the account from current authority and binds only an authorized installation. Do not expose an endpoint that lets the caller select another account as destination owner.

Proposed operations: register/update destination; remove the caller's installation destination; list safe installation summaries; internal `notifyAccount`/`notifyInstallation` with purpose, bounded payload, expiry and message identity. Re-registration updates token generation atomically. Account switch, logout and revoke follow a documented installation-binding policy; revoking one sibling session need not automatically remove a shared installation destination.

Async send/cleanup carries exact destination/binding/token generation. Recheck current eligibility before dispatch and condition invalid-token removal on the same generation. A delayed provider failure for an old token cannot delete a rotated token; a queued message for the prior account cannot be redirected to the installation's new owner. Data already accepted by a provider cannot be recalled reliably: keep sensitive content out of notification payloads and require authenticated application reads.

## FCM and APNs adapters

FCM handles ordinary Android/iOS/web destinations using the current supported Admin SDK/API. iOS FCM still needs appropriate APNs app/provider setup. Direct APNs is a separate provider with app/topic/environment/push-type configuration. An installation may have FCM ordinary and direct APNs VoIP destinations; purpose routing prevents duplicate ordinary sends through both providers unless explicitly requested.

APNs payload construction is purpose-specific: ordinary, background and VoIP have different topic/push-type/priority/expiry requirements. Validate those against current Apple documentation. VoIP requires a real call use case and client PushKit/CallKit handling; it is not a background-wakeup shortcut. Generate client setup and device acceptance guidance, not assertions that backend receipt proves OS presentation.

Provider outcomes are per destination: accepted with provider reference, invalid destination, permanent payload/configuration failure, retryable throttling/unavailability, and unknown. Remove only truly invalid tokens; never prune valid destinations because credentials, payloads or provider connectivity failed. Respect provider batch limits and bounded concurrency, retry/backoff/expiry. Record aggregate counts without exposing addresses/tokens. No exactly-once delivery promise.

Conditional config includes selected Firebase project/credentials, APNs key/team/topic/environment references, mail provider settings, payload/time/concurrency limits and purpose routing. External settings such as APNs certificates, Apple capabilities and browser push keys are explicit setup requirements. Firebase auth and messaging may share a configured client where safe; do not conflate their authorization roles.

## Delivery, testing and boundaries

Generate module wiring, DTOs, schemas/migrations, typed adapter outcomes, transport-neutral templates, config/docs and focused tests. Exercise both database adapters for ownership/generation transitions. Local/fake delivery tests establish application decisions; SMTP/provider acceptance and actual iOS/Android device behavior require separate evidence.

The main risks are token ownership races, stale cleanup, secret leakage, duplicate/unknown delivery, incorrect Apple purpose headers and misleading readiness claims. A production auth-email path remains pending until external configuration and acceptance pass. Readiness of unrelated routes should follow the app's declared dependency policy rather than fail because an optional marketing email provider is down.

Defer a general campaign system, arbitrary mail template editor, push analytics warehouse, full frontend apps and universal exactly-once outbox. Add an HTTP mail adapter as the later extension proof in Phase 09, using the same rendering and result contract.

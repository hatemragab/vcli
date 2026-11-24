# Selected mail lifecycle integration

Worker-owned runtime implementation; generated selection, packed installation and external acceptance are coordinator gates. `MailService.submit(MailMessage): Promise<MailOutcome>` stays compatible and has exactly one recipient. Every source caller awaits it. `accepted` means provider acceptance, `captured` means private development retention, and neither means inbox delivery. `unavailable` is retryable rejection; `unknown` is possible acceptance and never automatically retried. SMTP has no standard Retry-After; SMTP response text is never guessed as one. Other adapters may supply finite `retryAfterMs`, honored by the durable dispatcher with a 24-hour cap and expiry.

`mail.capture` and `mail.smtp` accept `{reliableActions:false}` by default. `{reliableActions:true}` requires an explicitly selected database. Firebase `{actionDelivery:'application'}` requires mail plus reliableActions; `{actionDelivery:'provider'}` is independent of SMTP. No runtime DB selector. Immediate SMTP requires no DB. Capture refuses production through the factory and direct constructor, validates count1–1000, retains at most1MiB for at most15minutes, has no public inspection route, and never emits content to diagnostics.

## Identity participant contract

`core/mail/action-delivery.ts` exports `ActionDeliveryWriter`:

```ts
prepare(message: MailMessage, expiresAt: number): PreparedMailIntent;
stage(prepared: PreparedMailIntent, context: TransactionContext): Promise<void>;
```

`PreparedMailIntent` is readonly `{operationId:string,purpose:'verification'|'password-reset'|'notification',expiresAt:number,keyId:string,payload:string}`. `payload` is canonical base64 of12-byte nonce +16-byte GCM tag + AES-256-GCM ciphertext. AAD binds version, operationId, purpose, expiresAt and keyId. Prepare the usable action/message ONCE outside a retryable callback; inside the owner transaction insert the action hash and call `await writer.stage(prepared,context)`. Both participants use the same selected database instance and opaque context. No nested owner commits or network I/O. Persisted operation IDs are immutable and duplicate staging is idempotent only for the identical prepared ciphertext and metadata. Commit uncertainty is handled by owner operation recovery; never prepare a new credential to recover a send. SMTP message IDs are stable but do not promise relay deduplication.

`new MailPayloadCipher(activeKeyId, keys)` takes `keys: Readonly<Record<string,string>>`. `MAIL_DELIVERY_KEYS_JSON` is a JSON object whose keys are safe `[A-Za-z0-9_-]{1,40}` key IDs and values are canonical padded RFC4648 base64 strings decoding to exactly32bytes. There are1–8keys; `MAIL_DELIVERY_KEY_ID` must select one. No usable example key is supplied. Keep this secret outside DB/captures/backups/logs/config plans, preferably in the deployment secret source. Roll out old+new keys first, change active ID second, retire old keys only after all retained payloads encrypted under them expire or complete; restored backups also need their historical keys. AES encryption is payload protection, not permission to export job rows. Restrict DB table/collection access to application/operator roles and protect backup access separately.

`new MailIntentService(store,cipher,sender,{maxAttempts,leaseMs,maxLifetimeMs},now?)` implements the writer. Values: maxAttempts1–10 (recommended3), leaseMs1000–300000 (recommended30000; exceed the selected SMTP timeout), maxLifetimeMs1000–86400000 (recommended3600000 and no later than the action expiry). Expose selected `MAIL_DELIVERY_MAX_ATTEMPTS`, `MAIL_DELIVERY_LEASE_MS`, `MAIL_DELIVERY_MAX_LIFETIME_MS`. `await drain(limit=20)` processes at most100 jobs serially. `list(limit=20)` returns only id/status/attempts/fence/expiry. `reconcile(operationId,expectedFence,'accepted'|'retry'|'rejected')` requires restricted operator/provider evidence; explicit retry acknowledges possible duplicates. Interrupted leases become unknown, never pending. CAS completion/reconciliation fence the exact claim and expiry. Accepted/rejected/expired payloads are erased; maintenance deletes terminal metadata after24hours. Invoke drain/maintenance regularly even without work so expired secrets are cleared; offline backup retention remains the operator's duty.

The mail renderer emits the bounded explicit `src/drain-mail.ts` entrypoint for reliable mail; root maps `mail:drain` to `node dist/drain-mail.js`. The entrypoint that opens only selected configured dependencies, invokes drain once, emits processed count only and finally closes owned resources. No startup scheduler, public jobs route or generic queue is implied. For schema release invoke `initializeMail(database):Promise<void>` from selected native `modules/mail/initialize-mail.ts`; never invoke on ordinary application startup. PostgreSQL initializer contains the idempotent table/index migration SQL; Mongo initializer creates the private collection/indexes. Root owns release orchestration/migration recording.

## Source manifest and composition

Every mail choice emits common `core/mail/mail-submitter.ts`, `modules/mail/mail.service.ts`, `modules/mail/render-message.ts`, and only the selected `capture-mail.service.ts` or `smtp-mail.service.ts`. Templates are versioned code-defined assets in render-message; no filesystem template path or extra asset package exists. Template ID verification/password-reset, version1, locale en and exactly actionUrl/applicationName variables are supported; other versions/locales/variables fail closed. HTML is always escaped canonical text, never caller HTML. Attachments and multi-recipient envelopes are unsupported.

Local auth also emits the neutral `core/mail/action-delivery.ts` interface because its optional participant type depends on the selected database context; DB-free capture/SMTP omit it. Reliable mail additionally emits common `core/mail/action-delivery.ts`, `modules/mail/mail-intent-types.ts`, `mail-payload-cipher.ts`, `mail-intent.service.ts`, plus selected native `modules/mail/mail-intent.entity.ts`, `mail-intent-store.ts`, `initialize-mail.ts`. `new MailIntentStore(database)` inherits the selected rich native BaseRepository and uses only that native driver and supplies no unscoped persistence handle to controllers. There are no new dependencies beyond existing selected native DB and Node crypto. Bind `MailIntentService` explicitly as a configured provider; pass its `ActionDeliveryWriter` capability to A1's action coordinator. Root's owned module/factory renderer composes these instances and exports providers to explicit consumer module imports.

`new SmtpMailService(options,production)` takes `{from,host,port,secure,user?,password?,timeoutMs?,maxConcurrency?}`; defaults10000ms/4concurrent. Bounds50–60000ms and1–16. Production requires TLS upgrade unless implicit TLS selected, verifies certificates and never accepts a bypass. Root maps optional SMTP_TIMEOUT_MS/SMTP_MAX_CONCURRENCY fields. Existing config shape remains assignable. The total delivery deadline also cuts off a peer trickling bytes; each submission uses a one-message Nodemailer pool with maxRequeues0 and public force-close support from pinned10.4.0. Pooling never implies automatic retry. Call `close()` at shutdown. One-recipient submits isolate transient/permanent outcomes from other recipients; a caller cannot accidentally retry an already accepted batch.

Firebase provider mode emits common `modules/mail/firebase-action-policy.ts` and `clients/mail-firebase-actions.mjs` WITHOUT mail transport or Admin helper. Application mode additionally emits `modules/mail/firebase-action-links.service.ts`; `new FirebaseActionLinksService(auth,policy,applicationName)` takes a purpose-specific `Pick<Auth,'generateEmailVerificationLink'|'generatePasswordResetLink'>`, no identity-feature imports. Root supplies identity-purpose Firebase Auth, keeps FCM purpose/credentials independent and closes only its own SDK app. `prepare({operationId,to,purpose,continueUrl})` returns prepared/message, suppressed, unavailable or configuration; message/link is private internal data. A1 owns verified actors, credential authorization, endpoint rate limits and enumeration-safe response mapping. Public response uses `publicEmailActionResponse()` for known/unknown outcomes; never forward raw provider errors or links publicly.

`FirebaseActionPolicy` is `{continueOrigins:readonly string[],linkDomain?:string,handleCodeInApp?:boolean,iOS?:{bundleId:string},android?:{packageName:string,installApp?:boolean,minimumVersion?:string}}`. Root maps FIREBASE_ACTION_CONTINUE_ORIGINS (JSON string array), optional FIREBASE_ACTION_LINK_DOMAIN and configured mobile bundle/package fields, rather than accepting client-controlled domains. `firebaseActionSettings(policy,purpose,continueUrl)` enforces exact allowlisted origin, no userinfo, HTTPS except loopback development, bounded URL and configured mobile targets. Only verification/password-reset purposes exist. Phone-only accounts need no invented email. LinkDomain is a custom Firebase Hosting project domain, not web.app/firebaseapp.com; absent uses Firebase default. dynamicLinkDomain is never sent.

Current behavior checked against installed firebase-admin14.5.0 ActionCodeSettings and [official SDK API](https://github.com/firebase/firebase-admin-node/blob/main/etc/firebase-admin.auth.api.md), [Hosting action settings](https://firebase.google.com/docs/auth/web/passing-state-in-email-actions) and [JS ActionCodeSettings](https://firebase.google.com/docs/reference/js/auth.actioncodesettings) through Context7. Configure Firebase authorized continue domains, Hosting/custom action handler, mobile association files and client SDK project/methods. The executable client asset receives configured Auth/user/settings and uses sendEmailVerification/sendPasswordResetEmail plus checkActionCode/applyActionCode or verifyPasswordResetCode/confirmPasswordReset, with purpose and redirect checks. It calls no local-password backend and mints no second JWT pair. Firebase Dynamic Links is not used. Real Firebase/client/mobile and SMTP/domain/SPF/DKIM/DMARC/Apple-relay/inbox acceptance remain external.

## Configured client usage

Root's exact optional mobile environment contributions are `FIREBASE_ACTION_HANDLE_CODE_IN_APP` (boolean defaultfalse), `FIREBASE_ACTION_IOS_BUNDLE_ID`, `FIREBASE_ACTION_ANDROID_PACKAGE_NAME`, `FIREBASE_ACTION_ANDROID_INSTALL_APP` (boolean), and `FIREBASE_ACTION_ANDROID_MINIMUM_VERSION` (decimal version-code string). Missing bundle/package omits that platform block; mobile-first requires at least one configured platform. `MAIL_APPLICATION_NAME` supplies the validated1–80character template label (a sanitized project name can be the generated default). Do not put passwords, email addresses or identity data in the continue URL.

```js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  sendManagedVerification,
  requestManagedReset,
  completeFirebaseAction,
} from './mail-firebase-actions.mjs';

// Public web SDK configuration from the selected Firebase project; no Admin key.
const app = initializeApp(firebaseWebConfig);
const auth = getAuth(app);
auth.languageCode = 'en';
const settings = {
  url: 'https://app.example.invalid/auth/complete',
  handleCodeInApp: false,
};
// In provider mode, verification requires the client's signed-in user.
await sendManagedVerification(auth.currentUser, settings);
await requestManagedReset(auth, enteredEmail, settings);
// A custom handler trusts fixed configuration, never origins from query params.
await completeFirebaseAction(
  auth,
  location.href,
  'verification',
  ['https://project.firebaseapp.com'],
  ['https://app.example.invalid'],
);
```

Replace example domains with the configured Firebase authorized domains, Hosting handler and application origin. For reset handling supply purpose password-reset and the newly chosen password; do not redirect until completion succeeds. The Firebase SDK validates code expiry/single-use; local fixture SDK maps test policy only. Application-delivery mode uses the same handler for the Admin-generated link sent through the selected mail adapter. On Android/iOS use current Firebase SDK Universal Links/App Links handling with the same configured Hosting domain/package/bundle; mobile device acceptance remains pending.

## Worker verification, 17 November 2026

`node --test --test-concurrency=1 test/mail-lifecycle-runtime.test.ts` passed16 local cases, skipped2 explicitly opt-in native database cases, with0failures. Before tests, the harness uses existing installed TypeScript/SDKs to compile strict MongoDB and PostgreSQL mail slices into ignored `var/cli-mail-lifecycle/{mongodb,postgres}/dist`; it installs nothing and never writes root/reference dist. This checks real selected native compiler/SDK contracts, not DB runtime behavior. Loopback SMTP peers run only in process on ephemeral127.0.0.1 ports and close all sockets/timers in finally. Cases include RCPT/DATA4xx/5xx, post-DATA disconnect/stall/trickling, concurrency denial, isolated per-recipient outcomes and no implicit DATA resubmission. Controlled Firebase client/Admin and persistence fakes are policy evidence; they perform no external network calls.

Passed scoped commands:

- `node node_modules/typescript/bin/tsc -p var/cli-mail-lifecycle/tsconfig.test.json --noEmit` (worker test source only).
- `node node_modules/eslint/bin/eslint.js test/mail-lifecycle-runtime.test.ts`.
- `node node_modules/eslint/bin/eslint.js --config var/cli-mail-lifecycle/eslint.config.mjs var/cli-mail-lifecycle/postgres/src/modules/mail var/cli-mail-lifecycle/postgres/src/core/mail var/cli-mail-lifecycle/mongodb/src/modules/mail` (same copied runtime sources with installed standard rules).
- `node node_modules/prettier/bin/prettier.cjs --check templates/runtime/common/src/core/mail templates/runtime/common/src/modules/mail templates/runtime/mongodb/src/modules/mail templates/runtime/postgres/src/modules/mail templates/runtime/common/clients/mail-firebase-actions.mjs test/mail-lifecycle-runtime.test.ts docs/CLI-MAIL.md`.

A first protocol run found three post-DATA errors misclassified unavailable due to Nodemailer's CONN label; classification was fixed and all affected cases rerun successfully. Additional deadline/requeue/rotation/client policies were then tested successfully. A scoped fixture initially included the unrelated native database factory without generated AppConfig; the fixture now excludes that factory and compiles the actual selected database/repository classes. This is isolated compilation, not a generated-app build claim.

Root runs native races/interruption against dedicated disposable database URLs, serially:

```sh
VCLI_MAIL_DATABASE=mongodb TEST_DATABASE_URL='<private Mongo replica-set test URL>' node --test --test-concurrency=1 test/mail-lifecycle-runtime.test.ts
VCLI_MAIL_DATABASE=postgres TEST_DATABASE_URL='<private PostgreSQL test URL>' node --test --test-concurrency=1 test/mail-lifecycle-runtime.test.ts
```

The native tests explicitly initialize only mail schemas, prove transaction rollback/idempotent-conflict staging, simultaneous exclusive claims, expired-lease unknown state, operator reconciliation and stale-worker denial. They leave bounded encrypted test intent metadata in the disposable database; do not use production or a shared data fixture. Root's assembled selection/config/composition/script mapping/schema release, packed install/build/HTTP, real native executions, Firebase managed/custom client/provider behavior, SMTP relay/domain/inbox and mobile/Apple-relay acceptance remain separate pending evidence. No installations, shared services, Docker, previews, provider accounts, commits or publications were performed by this worker.

## Mail renderer integration follow-up

`src/recipes/render-mail.ts` now exports `mailFiles(config)` and separate `firebaseMailFiles(config)`, both returning deterministic `Promise<RenderedFile[]>`. Root calls the latter for every Firebase selection even when no transport is selected. Without mail, Firebase policy's dependency closure adds only neutral render-message/MailMessage source alongside its policy/client asset; no transport, mail module, durable store or Admin action helper is emitted. With mail those dependencies come only from mailFiles, so combined paths are unique. The Admin helper remains application-only. Local auth receives the neutral ActionDeliveryWriter type even for immediate delivery; other immediate mail stays DB-free.

Generated `createMailRuntime(config,database?,dependencies:MailRuntimeDependencies={})` is synchronous and returns `MailRuntime` with `{sender:MailService,intents,module:DynamicModule,close():Promise<void>}`. Immediate intents is typed undefined and the optional database argument is ignored without any DB import; reliable intents is typed MailIntentService and database is the selected native class, with missing database rejected before sender construction. It consumes root's frozen `config.mailDelivery = {activeKeyId,keys,maxAttempts,leaseMs,maxLifetimeMs}`; SMTP receives the selected flat config.mail including timeoutMs/maxConcurrency. MailModule binds MailService and, for configured reliable runtime, MailIntentService as normal providers/exports. MailRuntimeDependencies is readonly `{sender?:MailService}` for explicit trusted programmatic injection only; it has no config, environment or HTTP path. The exact injected sender supplies both the exported provider and reliable intents. Factory failure and normal idempotent close shut down only a factory-owned SMTP sender; injected senders remain caller-owned, with no-op capture cleanup. Selected capture still refuses production even with a trusted sender supplied. The factory never closes its caller-owned database. Stable createMailSender/createTestMailCapture helpers remain available.

Reliable output includes `src/drain-mail.ts`; execute `node dist/drain-mail.js [--limit 1..100]` (default20), or root's mail:drain script mapping. It validates arguments before configuration, loads the selected private environment/config, opens the chosen database via `openDatabase(config,false)` so mail-only does not require an identity migration marker, and drains once. It prints only processed count after cleanup succeeds; all failure paths print fixed MAIL_DRAIN_FAILED and return exit1. Finally closes sender and database on success/failure, including failed runtime construction; no schema initialization, background scheduler, public route or diagnostic SDK import is added. Root owns combined explicit schema release and create-app wiring. Root's Firebase action config remains `{policy,continueUrl,applicationName,deliveryLifetimeMs}` for A1; the mail factory does not create another Firebase credential owner.

Follow-up evidence: `node --test --test-concurrency=1 test/mail-rendering.test.ts` passed13cases with0failures. It compiles eight selected mail source profiles in ignored var/cli-mail-integration only: DB-free capture/SMTP, local immediate neutral contract, Mongo capture reliable, PostgreSQL SMTP reliable, Firebase provider without mail, and both Firebase application/reliable DB variants. Normal Nest application contexts inject exported services into a separate explicit consumer module. Native model constructors use only disconnected/controlled handles; no database is contacted. Controlled drain peers prove limit rejection before setup, no identity-marker requirement, safe fixed failures and cleanup after config/open/drain/shutdown errors. Generated SMTP close and injected sender identity/ownership are checked without network. Initial generated-output lint caught a redundant capture catch and unsafe finally/initial assignment in the drain; those were corrected and the affected full focused run passed.

Passed follow-up checks:

- `node node_modules/typescript/bin/tsc -p var/cli-mail-integration/tsconfig.worker.json --noEmit` (renderer/test and traced pure generator dependencies only).
- `node node_modules/eslint/bin/eslint.js src/recipes/render-mail.ts test/mail-rendering.test.ts`.
- `node node_modules/eslint/bin/eslint.js var/cli-mail-integration/profiles/*/src/modules/mail var/cli-mail-integration/profiles/*/src/core/mail var/cli-mail-integration/profiles/*/src/drain-mail.ts`.
- `node node_modules/prettier/bin/prettier.cjs --check src/recipes/render-mail.ts test/mail-rendering.test.ts docs/CLI-MAIL.md`.

No other root renderers, shared config/catalog/package/lock/composition, identity/diagnostics source, combined schema entrypoint or reviewed references were edited. Packed installation/build/HTTP, assembled root integration, real native intent races and external provider/client/device/inbox acceptance remain coordinator work; disconnected constructor and controlled peer evidence do not claim those outcomes.

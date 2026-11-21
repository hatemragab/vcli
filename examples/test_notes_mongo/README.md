# test_notes_mongo

<!-- vcli:managed:start -->

VCLI generated NestJS application. Selected capabilities:

- auth: auth.local
- database: database.mongodb
- diagnostics: diagnostics.local
- foundation: foundation.nest
- media: media.private
- notes: example.notes
- storage: storage.local

Use make install to bootstrap the vendored CLI and record application installation through VCLI, then npm run check, npm run build and npm start. Plain npm install does not update vcli.lock.json outcomes. Development uses make dev or npm run start:dev. Set APP_ENV_FILE to an explicitly chosen private file if needed; process environment takes precedence. Copy only the selected example keys and supply required blank values privately. Health endpoints are GET /health/live and GET /health/ready. Readiness means local initialization succeeded; external acceptance is separate. The public buildId is read from immutable dist/build-metadata.json, never runtime environment. Unversioned or dirty local builds report null; deployment verification requires the reviewed source commit and independent native image identity.

The project pins its local CLI via tools/vcli. vcli.json describes desired choices; vcli.lock.json records realized source, installation and check outcomes independently. Source output alone does not establish installation, build, boot or provider acceptance.

Selected API schemas are available at /docs and /docs-json; Swagger does not persist authorization. Local protected routes require the bearer access token.

This profile authenticates by username and password. Identity actions do not require mail. Register at POST /api/identity/local/register, then log in at POST /api/identity/local/login with username, password and a separate private installationCapability. Passwords are hashed with Argon2; JWT access and rotating refresh sessions are unchanged. Email remains absent and unverified. Email verification and forgotten-password reset routes are not emitted. Keep your password: recovery is unavailable; authenticated current-password change remains available. The native identity schema retains its existing inactive action storage.

Run npm run db:initialize after build, using the same selected environment, before application startup. Each selected owner initializes through the fenced release ledger. Earlier completed setup survives a later failure. Inspect and explicitly reconcile unknown or incomplete attempts before retry; ordinary boot validates the exact acknowledged manifest and never migrates. See ops/release/README.md for private backup and isolated restore profiles.

First run uses one owner-only config file copied from the selected example (mode 0600). Start the selected database, set every blank required value including JWT_KEYS_JSON, then run vcli config check --config-file <file>, npm run build, vcli release apply --config-file <file>, and vcli dev --config-file <file>. Confirm GET /health/ready and GET /docs. Release and dev use that same file. make services-up starts the local database and does not apply a release.

The functional notes example provides POST /api/notes and owner-scoped GET /api/notes and /api/notes/:id. Inputs never choose the owner. This profile does not select realtime. See src/modules/notes/README.md and clients/notes-client.mjs.

Makefile supports make dev, dev-plan, services-plan/up/down/status and local-prod. Set ENVIRONMENT=test for isolated test service volumes. Starting services does not run schema release or prove provider readiness.

Run npm exec -- vcli check for architecture, database isolation, lint and type checking. Build before running tests that import dist. See AGENTS.md for the feature development workflow.

Known limits:

- Username/password authentication has no email verification or forgotten-password recovery. No email ownership is claimed; authenticated current-password change is available.
- Storage emits only the selected transfer modes. Named AWS/R2 provider acceptance and permissions remain separate; arbitrary custom S3 profiles are unsupported.
- Diagnostic evidence is bounded, sanitized and may contain gaps. Restricted remote reads require a private scoped profile and independently verified HTTPS boundary; isolated/shared-production profiles are unsupported.

Required setup and integration:

- Configure MongoDB replica set or sharded transactional topology; initialize selected schemas before boot.
- Supply private JWT_KEYS_JSON and JWT_ACTIVE_KID with independently generated keys. Retain overlap keys through token and backup lifetimes; clients singleflight refresh and reauthenticate after an ambiguous response.
- Provide a private writable durable local storage directory.

<!-- vcli:managed:end -->

Add application-specific business contracts and operational evidence here.

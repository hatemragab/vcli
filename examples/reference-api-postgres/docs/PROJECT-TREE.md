# Reference application file tree

Current independent PostgreSQL/Drizzle + pg expected-output project. Dependencies, generated build output, private environment files and runtime data are excluded.

```text
reference-api-postgres/
├── clients/
│   ├── centrifugo.mjs
│   ├── native-ws.mjs
│   └── socket-io.mjs
├── docs/
│   ├── agent-prompts/
│   │   ├── auth-review-fix.md
│   │   ├── identity-integration-fixes.md
│   │   ├── identity.md
│   │   ├── independent-review.md
│   │   ├── operations-review-fixes.md
│   │   ├── README.md
│   │   ├── realtime-integration-fixes.md
│   │   ├── realtime-operations.md
│   │   ├── service-baseline-alignment.md
│   │   ├── simplification-final-review.md
│   │   ├── simplification-mongo-index-fix.md
│   │   ├── simplify-identity-database.md
│   │   ├── simplify-realtime-diagnostics.md
│   │   ├── simplify-storage-delivery.md
│   │   └── storage-delivery.md
│   ├── assets/
│   │   └── reference-workbench.png
│   ├── architecture.md
│   ├── base-repository.md
│   ├── CODE-WALKTHROUGH.md
│   ├── delivery.md
│   ├── identity.md
│   ├── IMPLEMENTATION-CONTRACT.md
│   ├── operations.md
│   ├── PROJECT-TREE.md
│   ├── realtime.md
│   ├── storage.md
│   ├── VERIFICATION-HISTORY.md
│   └── VERIFICATION.md
├── migrations/
│   ├── 001-identity.sql
│   └── initialize-identity.mjs
├── ops/
│   ├── centrifugo/
│   │   └── config.json
│   ├── deploy/
│   │   ├── caprover/
│   │   │   ├── captain-definition
│   │   │   └── README.md
│   │   ├── coolify/
│   │   │   ├── compose.yml
│   │   │   └── README.md
│   │   └── dokploy/
│   │       ├── compose.yml
│   │       └── README.md
│   ├── diagnostics/
│   │   ├── logdy-live.sh
│   │   └── vector.yaml
│   ├── local/
│   │   ├── compose.orca.example.yml
│   │   └── services.env.example
│   ├── .dockerignore
│   ├── compose.development.yml
│   ├── Dockerfile
│   ├── Dockerfile.dockerignore
│   ├── follow-up-transport-review.md
│   ├── postgres-native-worker-report.md
│   └── worker-delivery-report.md
├── scripts/
│   ├── architecture-rules.ts
│   ├── check-architecture.ts
│   ├── check-database.ts
│   ├── database-isolation-rules.ts
│   ├── demo.ts
│   ├── diagnostics-mcp.mjs
│   └── migrate.ts
├── src/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── enrollment-cutoff.ts
│   │   │   ├── principal-authority.ts
│   │   │   └── principal.ts
│   │   ├── config/
│   │   │   ├── app-config.ts
│   │   │   └── load-config.ts
│   │   ├── database/
│   │   │   ├── base-repository.ts
│   │   │   ├── database-errors.ts
│   │   │   ├── database.ts
│   │   │   ├── postgres-database.ts
│   │   │   ├── repository-types.ts
│   │   │   └── transaction-context.ts
│   │   ├── diagnostics/
│   │   │   └── diagnostic-events.ts
│   │   ├── errors/
│   │   │   ├── application-error.ts
│   │   │   └── diagnostic-error-code.ts
│   │   ├── http/
│   │   │   ├── current-principal.decorator.ts
│   │   │   ├── http-diagnostic-facts.ts
│   │   │   ├── http-error.filter.ts
│   │   │   ├── http-security.module.ts
│   │   │   ├── openapi-security.ts
│   │   │   ├── parse-input.ts
│   │   │   ├── principal.guard.ts
│   │   │   └── record-request.ts
│   │   ├── logging/
│   │   │   ├── app-logger.service.ts
│   │   │   ├── log-event-schema.ts
│   │   │   └── logging.module.ts
│   │   ├── mail/
│   │   │   └── mail-submitter.ts
│   │   └── realtime/
│   │       └── event-publisher.ts
│   ├── generated/
│   │   └── vcli-app.module.ts
│   ├── modules/
│   │   ├── accounts/
│   │   │   ├── account.entity.ts
│   │   │   ├── account.module.ts
│   │   │   ├── account.service.ts
│   │   │   └── current-account.controller.ts
│   │   ├── diagnostics/
│   │   │   ├── diagnostic-reader.service.ts
│   │   │   ├── diagnostic-reader.ts
│   │   │   ├── diagnostic-schema.ts
│   │   │   ├── diagnostics-mcp.service.ts
│   │   │   ├── diagnostics.module.ts
│   │   │   └── diagnostics.service.ts
│   │   ├── health/
│   │   │   └── health.controller.ts
│   │   ├── identity/
│   │   │   ├── action-tokens.controller.ts
│   │   │   ├── action-tokens.service.ts
│   │   │   ├── argon-passwords.service.ts
│   │   │   ├── change-password.controller.ts
│   │   │   ├── change-password.service.ts
│   │   │   ├── credential-ports.ts
│   │   │   ├── firebase-enrollment.service.ts
│   │   │   ├── firebase-identity.controller.ts
│   │   │   ├── firebase-token-verifier.service.ts
│   │   │   ├── identity-authority.service.ts
│   │   │   ├── identity-inputs.ts
│   │   │   ├── identity-rate-limits.service.ts
│   │   │   ├── identity-request-bodies.ts
│   │   │   ├── identity.entity.ts
│   │   │   ├── identity.module.ts
│   │   │   ├── identity.service.ts
│   │   │   ├── jose-access-tokens.service.ts
│   │   │   ├── local-credentials.service.ts
│   │   │   ├── local-identity.controller.ts
│   │   │   ├── rate-request.ts
│   │   │   └── secret-facts.ts
│   │   ├── installations/
│   │   │   ├── installation.entity.ts
│   │   │   ├── installation.module.ts
│   │   │   └── installation.service.ts
│   │   ├── mail/
│   │   │   ├── capture-mail.service.ts
│   │   │   ├── mail.module.ts
│   │   │   ├── mail.service.ts
│   │   │   ├── render-message.ts
│   │   │   └── smtp-mail.service.ts
│   │   ├── media/
│   │   │   ├── capabilities.module.ts
│   │   │   ├── media-state-store.ts
│   │   │   ├── media-storage-mapping.ts
│   │   │   ├── media-transitions.ts
│   │   │   ├── media.controller.ts
│   │   │   ├── media.entity.ts
│   │   │   ├── media.module.ts
│   │   │   ├── media.repository.ts
│   │   │   ├── media.service.ts
│   │   │   └── postgres-media-state-store.ts
│   │   ├── notes/
│   │   │   ├── notes.controller.ts
│   │   │   ├── notes.entity.ts
│   │   │   ├── notes.module.ts
│   │   │   └── notes.service.ts
│   │   ├── push/
│   │   │   ├── apns-payload.ts
│   │   │   ├── apns-push.service.ts
│   │   │   ├── fcm-push.service.ts
│   │   │   ├── postgres-push-state-store.ts
│   │   │   ├── push-state-store.ts
│   │   │   ├── push-storage-mapping.ts
│   │   │   ├── push-transitions.ts
│   │   │   ├── push.controller.ts
│   │   │   ├── push.entity.ts
│   │   │   ├── push.module.ts
│   │   │   ├── push.repository.ts
│   │   │   └── push.service.ts
│   │   ├── realtime/
│   │   │   ├── centrifugo-api.service.ts
│   │   │   ├── centrifugo-connection.service.ts
│   │   │   ├── centrifugo-proxy.controller.ts
│   │   │   ├── native-ws.service.ts
│   │   │   ├── protocol-validation.ts
│   │   │   ├── realtime-ticket.service.ts
│   │   │   ├── realtime.controller.ts
│   │   │   ├── realtime.module.ts
│   │   │   ├── realtime.service.ts
│   │   │   └── socket-io.service.ts
│   │   ├── review/
│   │   │   ├── review-page.ts
│   │   │   ├── review.controller.ts
│   │   │   └── review.tokens.ts
│   │   ├── sessions/
│   │   │   ├── refresh-sessions.service.ts
│   │   │   ├── session-facts.ts
│   │   │   ├── session-issuer.service.ts
│   │   │   ├── session-management.service.ts
│   │   │   ├── session-policy.ts
│   │   │   ├── session.entity.ts
│   │   │   ├── session.service.ts
│   │   │   ├── sessions.controller.ts
│   │   │   └── sessions.module.ts
│   │   └── storage/
│   │       ├── local-storage.service.ts
│   │       ├── private-filesystem.ts
│   │       ├── s3-storage.service.ts
│   │       ├── storage.entity.ts
│   │       ├── storage.module.ts
│   │       └── storage.service.ts
│   ├── app.custom.module.ts
│   ├── app.module.ts
│   ├── create-reference-app.ts
│   ├── initialize-identity-database.ts
│   └── main.ts
├── test/
│   ├── e2e/
│   │   └── reference.test.ts
│   ├── helpers/
│   │   ├── account-query-fixture.ts
│   │   ├── native-values-repository.ts
│   │   ├── once-socket.ts
│   │   └── postgres-fixture.ts
│   ├── base-repository.test.ts
│   ├── config.test.ts
│   ├── database-isolation.test.ts
│   ├── delivery-composition.test.ts
│   ├── delivery-persistence.test.ts
│   ├── delivery-smtp.test.ts
│   ├── delivery.test.ts
│   ├── dependency-rules.test.ts
│   ├── diagnostics-live.test.ts
│   ├── diagnostics-mcp.test.ts
│   ├── diagnostics-reader.test.ts
│   ├── identity-database-errors.test.ts
│   ├── identity-firebase-errors.test.ts
│   ├── identity.test.ts
│   ├── listener-cleanup.test.ts
│   ├── logging.test.ts
│   ├── media-persistence.test.ts
│   ├── media.test.ts
│   ├── notes-persistence.test.ts
│   ├── notes.test.ts
│   ├── operation-correlation.test.ts
│   ├── realtime-centrifugo.test.ts
│   ├── realtime-module.test.ts
│   ├── realtime-protocol.test.ts
│   ├── realtime-tickets.test.ts
│   └── startup-errors.test.ts
├── .env.development.example
├── .env.production.example
├── .env.test.example
├── .gitignore
├── .prettierrc.json
├── AGENTS.md
├── eslint.config.mjs
├── Makefile
├── nest-cli.json
├── package-lock.json
├── package.json
├── README.md
├── reference-profile.json
├── tsconfig.build.json
├── tsconfig.json
└── tsconfig.test.json
```

See [the walkthrough](CODE-WALKTHROUGH.md) and [current verification](VERIFICATION.md).

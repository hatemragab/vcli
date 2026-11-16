# Reference and verification map

**Status: planning references, not implementation evidence.** These source-review links and official documentation entry points were retained from the discussion and review material. They were not newly verified while preparing this document. Exact version, API, security, platform, and compatibility claims must be rechecked in [Phase 00](../phases/00-design-baseline/README.md) and again when relevant implementation begins.

[DECISIONS.md](DECISIONS.md) is the active recommended baseline. A documentation example does not prove that VCLI's selected combination works, and an earlier source checkout is not a dependency version policy. No private checkout or conversation history is required to follow these links.

## Framework, persistence, and validation

| Official reference | Question to verify |
| --- | --- |
| [Nest CLI](https://github.com/nestjs/nest-cli) and [Nest CLI usage](https://docs.nestjs.com/cli/usages) | Public generation/build extension points; VCLI should retain ordinary Nest workflows. |
| [Nest validation](https://docs.nestjs.com/techniques/validation) and [Zod](https://zod.dev/) | Exact schema integration, unknown-key behavior, safe error mapping, OpenAPI and WebSocket support. Do not presume a compatible officially maintained bridge. |
| [Mongoose transactions](https://mongoosejs.com/docs/transactions.html) | Transaction topology, session propagation, retries, and prohibited parallel operations. |
| [Drizzle transactions](https://orm.drizzle.team/docs/transactions) and [migrations](https://orm.drizzle.team/docs/migrations) | The selected PostgreSQL driver's transaction/migration APIs and release coordination requirements. |
| [Node crypto](https://nodejs.org/api/crypto.html) | Cryptographic UUIDv4/random-token generation, hashing primitives, and runtime compatibility. |

## Identity and realtime

| Official reference | Question to verify |
| --- | --- |
| [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens) and [session management](https://firebase.google.com/docs/auth/admin/manage-sessions) | Issuer/audience, revocation and disabled-user checks, SDK options, token freshness and outage behavior. Recheck the exact selected Admin SDK rather than extrapolating from one option name. |
| [Firebase email action links](https://firebase.google.com/docs/auth/admin/email-action-links), [phone authentication](https://firebase.google.com/docs/auth/web/phone-auth), and [Apple authentication](https://firebase.google.com/docs/auth/web/apple) | Provider/client setup and action-link delivery. Generated backend files do not enable native providers automatically. |
| [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging), [Apple remote notifications](https://developer.apple.com/documentation/usernotifications), and [PushKit](https://developer.apple.com/documentation/pushkit) | Selected provider SDK/API, app/environment credentials, token lifecycle, purpose-specific APNs headers and real-device/CallKit requirements. |
| [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Hashing choices and measured resource/work factors; review application limits separately. |
| [Nest WebSocket adapters](https://docs.nestjs.com/websockets/adapter) | Socket.IO versus native WebSocket protocols, adapters, and scaling constraints. |
| [Centrifugo backend proxies](https://centrifugal.dev/docs/server/proxy) | Admission/refresh/subscription hooks and proxy header handling. Do not assume a static secret header overrides a forwarded client header safely. |

## Storage, diagnostics, and deployment

| Official reference | Question to verify |
| --- | --- |
| [AWS S3 PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html) and [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) | Conditional writes, checksum support, immutable/version-bound finalization, and remaining grant validity. |
| [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/) | Provider-specific supported operations; a custom endpoint is not blanket S3 compatibility. |
| [Vector](https://github.com/vectordotdev/vector) and [Docker source](https://vector.dev/docs/reference/configuration/sources/docker_logs/) | Collection/transformation, source delivery limits, permissions, and gap reporting. |
| [Logdy overview](https://logdy.dev/docs/what-is-logdy), [buffering](https://logdy.dev/docs/explanation/following-logs), [REST API](https://logdy.dev/docs/reference/rest-api), and [LogdyPro](https://logdy.dev/logdy-pro) | Live feed/buffer versus retained query capability. Documented ingestion does not establish a historical query API. |
| [Dokploy Compose](https://docs.dokploy.com/docs/core/docker-compose), [Coolify deployment model](https://coolify.io/docs/core/build-deployment-model), and [CapRover Compose support](https://caprover.com/docs/docker-compose) | Native profiles, variable injection, persistence, release behavior, and supported automation; verify each target separately. |

Record selected versions, retrieval date, relevant behavior, implementation decision, and acceptance evidence in the phase records. Documentation supports design reasoning; local integration, native/provider interaction, cross-instance operation, deployment, and restore need their own evidence under [VERIFICATION.md](VERIFICATION.md).

# Product scope and traceability

## Objective

Create a reusable NestJS generator that captures Hatem's conventions and common backend capabilities. A new project should install, build, run, and be understandable without an AI agent repairing missing wiring. Later generation uses choices already recorded in the project's workspace configuration.

This is a standalone product. Existing SuperUp/Whizpee implementations may inform a later authorized extraction audit, but this package neither verifies their current source nor requires access to them. Do not copy product workflows, short legacy database field names, secrets, or branding into a generic starter by assumption.

## Main journeys

1. Create an API, selecting database, identity provider, and optional capabilities through prompts or flags.
2. Add SMTP, push, realtime, or media later. VCLI plans dependencies, writes files, registers configuration, and updates selected-feature documentation.
3. Let an AI agent inspect installed choices, generate a feature through the pinned local CLI, implement business logic, and run meaningful checks.
4. Run locally, collect correlated test evidence, and deploy using a documented platform profile.
5. Deliver a security or compatibility update without overwriting customized business code.

Commands are proposed UX, not installed tools. `vcli init`, `add`, `g`, `inspect`, `doctor`, and `check` are the initial families. Services, diagnostics, deployment, and upgrade commands arrive with their phases. Avoid synonyms that duplicate the same operation.

## Required catalog

| Family | Choices and boundaries |
| --- | --- |
| Database | MongoDB and PostgreSQL. One implementation per app initially; no automatic data migration or equivalent arbitrary queries. |
| Authentication | Firebase identity or local email/password with application JWT access tokens; application-owned accounts and independently revocable sessions. |
| Firebase methods | Email/password, phone, Google, Apple. Generate backend integration, configuration requirements, and client/provider instructions; external consoles/signing credentials need authorized setup. |
| Realtime | Socket.IO, Centrifugo, native WebSocket. Centrifugo includes separate service configuration and backend integration. Protocols and delivery guarantees remain explicit. |
| Email | SMTP application mail, development capture, Firebase-managed action mail, or application delivery of Firebase action links. Firebase is not general SMTP. An HTTP mail provider is an extension proof. |
| Devices/push | Multiple installations and sessions; purpose-specific FCM/APNs destinations, token rotation, ownership, invalid-token cleanup, ordinary/VoIP distinctions. |
| Media | Local filesystem, AWS S3, verified S3-compatible profiles. Private access, bounded uploads, safe finalization, lifecycle cleanup. |
| Environment | Development/production templates, typed conditional validation, secret references, deployment injection. Actual secrets are not committed or copied. |
| Development | Standard Nest scripts and selected services; up/down preserves durable data, ports and resource requirements are explicit. |
| Deployment | Dokploy, Coolify, CapRover; each has supported topology, artifacts, runbook, verification, and phased API automation. |
| Diagnostics | NestJS/worker/database/infrastructure collection, Vector, Logdy, retained test evidence, scoped read-only MCP. |
| Agent guidance | README, canonical AGENTS instructions, supported tool-specific bridge, feature-aware commands and rules. Measurable rules are enforced with checks; Markdown cannot guarantee compliance. |

## Requirement register

IDs preserve the original proposal's scope. Linked acceptance registers define proof; this table is not a completion claim.

| Requirement | Scope | Primary acceptance registers |
| --- | --- | --- |
| REQ-01 | Complete NestJS starter in selected style | [01](../phases/01-project-foundation/ACCEPTANCE.md) |
| REQ-02 | Safe addition after customization | [02](../phases/02-safe-generation/ACCEPTANCE.md), [09](../phases/09-upgrades-extensibility/ACCEPTANCE.md) |
| REQ-03 | Feature/command/query/controller/service/DTO/repository/realtime generators | [02](../phases/02-safe-generation/ACCEPTANCE.md), [03](../phases/03-authentication-databases/ACCEPTANCE.md), [04](../phases/04-realtime/ACCEPTANCE.md) |
| REQ-04 | Workspace JSON drives generation | [01](../phases/01-project-foundation/ACCEPTANCE.md), [02](../phases/02-safe-generation/ACCEPTANCE.md) |
| REQ-05 | Firebase and local JWT auth | [03](../phases/03-authentication-databases/ACCEPTANCE.md) |
| REQ-06 | Firebase email/password, phone, Google, Apple | [03](../phases/03-authentication-databases/ACCEPTANCE.md) |
| REQ-07 | Accounts, installations, sessions, revocation, destinations | [03](../phases/03-authentication-databases/ACCEPTANCE.md), [04](../phases/04-realtime/ACCEPTANCE.md), [05](../phases/05-email-push/ACCEPTANCE.md) |
| REQ-08 | MongoDB/PostgreSQL behavioral contracts | [03](../phases/03-authentication-databases/ACCEPTANCE.md) |
| REQ-09 | Three realtime providers | [04](../phases/04-realtime/ACCEPTANCE.md) |
| REQ-10 | Centrifugo service/backend integration | [04](../phases/04-realtime/ACCEPTANCE.md), [08](../phases/08-deployment/ACCEPTANCE.md) |
| REQ-11 | SMTP and Firebase action email | [05](../phases/05-email-push/ACCEPTANCE.md) |
| REQ-12 | FCM/APNs purpose-specific push | [05](../phases/05-email-push/ACCEPTANCE.md) |
| REQ-13 | Local/S3/compatible storage | [06](../phases/06-storage-media/ACCEPTANCE.md) |
| REQ-14 | Development/production environment configuration | [01](../phases/01-project-foundation/ACCEPTANCE.md), [08](../phases/08-deployment/ACCEPTANCE.md) |
| REQ-15 | Dokploy, Coolify, CapRover | [08](../phases/08-deployment/ACCEPTANCE.md) |
| REQ-16 | Application/infrastructure logs, Vector, Logdy | [07](../phases/07-diagnostics-ai/ACCEPTANCE.md) |
| REQ-17 | Scoped MCP evidence | [07](../phases/07-diagnostics-ai/ACCEPTANCE.md) |
| REQ-18 | Human/agent documentation | [01](../phases/01-project-foundation/ACCEPTANCE.md), [02](../phases/02-safe-generation/ACCEPTANCE.md) |
| REQ-19 | Maintainable code and honest verification | All; [policy](VERIFICATION.md) |
| REQ-20 | Extendable recipes/providers/targets/readers | [02](../phases/02-safe-generation/ACCEPTANCE.md), [09](../phases/09-upgrades-extensibility/ACCEPTANCE.md) |
| REQ-21 | Preserve customizations, secrets, durable data | [02](../phases/02-safe-generation/ACCEPTANCE.md), [06](../phases/06-storage-media/ACCEPTANCE.md), [08](../phases/08-deployment/ACCEPTANCE.md), [09](../phases/09-upgrades-extensibility/ACCEPTANCE.md) |
| REQ-22 | Interactive/noninteractive workflows | [01](../phases/01-project-foundation/ACCEPTANCE.md), [02](../phases/02-safe-generation/ACCEPTANCE.md) |

## Boundaries

VCLI does not replace Nest's compiler, build an external identity provider, guarantee arbitrary plugins, or provision paid infrastructure without authorization. Local authentication is an embedded credential subsystem and needs security ownership.

No full mobile/web client generator is required. Client contracts, examples, and real-device acceptance are required where backend behavior depends on them. No automatic migration between identity systems, databases, realtime protocols, or storage providers is promised. Editing configuration cannot migrate data.

Queues, an outbox, caching, presence, historical replay, scanning, tracing, and extra provider packs are added where an implemented requirement needs them. They are not mandatory infrastructure for every starter.

## Success

A second engineer can create a project, customize it, add a capability, generate a feature, test it, inspect diagnostics, and follow deployment instructions without the old chat or checkout. A provider extension changes its adapter/recipe/tests/docs plus a registry entry, without provider conditions scattered through business consumers.

Full scope is complete only when every requested family has declared acceptance evidence. Compilation, provider reachability, device delivery, and production behavior remain separate claims.

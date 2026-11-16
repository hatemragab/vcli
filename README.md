# VCLI — standalone project and implementation plan

VCLI will generate ordinary NestJS projects in Hatem's coding style, remember project choices, and safely add capabilities later. Developers and AI agents will use the same generators, documentation, and verification commands.

**Status: planning only.** This package contains the full proposed delivery plan; the CLI and integrations have not been implemented. No phase is complete merely because its documents exist.

## Start here

This is the standalone VCLI repository. Read [START-HERE.md](START-HERE.md) to launch an implementation session here. The planning documents live at the repository root; no SuperUp source, credentials, milestones, or private conversation history are required.

| Document | Purpose |
| --- | --- |
| [Product scope](docs/PRODUCT.md) | Everything requested, provider choices, and requirement-to-phase mapping |
| [Architecture](docs/ARCHITECTURE.md) | Shared contracts, ownership, configuration, and coding structure |
| [Decisions](docs/DECISIONS.md) | Recommended defaults, rationale, and unresolved choices |
| [Verification](docs/VERIFICATION.md) | Evidence levels, support matrix, and completion gates |
| [Review synthesis](docs/REVIEW-SYNTHESIS.md) | Which review ideas were retained, corrected, or deferred |
| [References](docs/REFERENCES.md) | Official documentation to verify before selecting versions |
| [Contributor instructions](AGENTS.md) | Standalone coding and agent rules |
| [Phase status](phases/STATUS.md) | Implementation progress and acceptance evidence |

## Delivery phases

Each phase contains `README.md` for design and scope, `TASKS.md` for ordered work, and `ACCEPTANCE.md` for the evidence required to finish. Start with the [phase workflow](phases/README.md).

| Phase | Deliverable |
| --- | --- |
| [00 — Design baseline](phases/00-design-baseline/README.md) | Resolve the baseline, conventions, support boundaries, and feasibility questions |
| [01 — Project foundation](phases/01-project-foundation/README.md) | Minimal NestJS app with configuration, logs, health, README, and agent rules |
| [02 — Safe generation](phases/02-safe-generation/README.md) | Add capabilities and generate feature code without overwriting custom work |
| [03 — Authentication and databases](phases/03-authentication-databases/README.md) | Firebase/local JWT auth, multi-device sessions, MongoDB/PostgreSQL |
| [04 — Realtime](phases/04-realtime/README.md) | Socket.IO, Centrifugo service integration, native WebSocket |
| [05 — Email and push](phases/05-email-push/README.md) | SMTP, Firebase action-email choices, FCM, purpose-specific APNs |
| [06 — Storage and media](phases/06-storage-media/README.md) | Local files, AWS S3, one verified S3-compatible provider |
| [07 — Diagnostics and AI](phases/07-diagnostics-ai/README.md) | Vector, Logdy, retained evidence, scoped read-only MCP |
| [08 — Deployment](phases/08-deployment/README.md) | Platform-specific deployment for Dokploy, Coolify, CapRover |
| [09 — Upgrades and extensibility](phases/09-upgrades-extensibility/README.md) | Safe maintenance, security updates, proven extension workflow |

The first useful milestone is Phases 01–02: create a working project, customize it, add a capability, and verify that custom work survives. The wider product remains in scope behind explicit acceptance gates.

## Design direction

- Small contracts at actual provider boundaries; no speculative layer for every function.
- Normal NestJS build/start and developer-owned application code.
- Tool-owned registration/configuration files make later additions predictable.
- A project JSON file records choices; a separate lock records what was generated.
- One provider per exclusive family; multiple providers where a real use case needs them, such as ordinary and VoIP push.
- Trusted libraries and a narrow shared authentication package for security mechanics; visible application policy and persistence mapping.
- Honest evidence: generated, locally tested, provider-tested, and deployed are different states.

Revision 0.2, prepared 16 November 2026. The [original proposal](docs/archive/original-proposal-2026-11-14.md) is preserved for history. Active documents supersede its roadmap and conflicting recommendations. Source provenance and dependency versions still need Phase 00 verification.

# Review synthesis and corrections

**Status: recommended design baseline, implementation not started.** The independent reviews informed this plan; agreement among models is not evidence of correctness or owner approval. [DECISIONS.md](DECISIONS.md) supersedes conflicting earlier recommendations. [PRODUCT.md](PRODUCT.md) preserves the full requested scope, and [VERIFICATION.md](VERIFICATION.md) defines support claims.

## Retained and simplified

Use a standalone TypeScript CLI with a curated recipe registry and dependency DAG. Keep normal Nest build/start, one handwritten class per file, owner-controlled persistence, pure application/domain behavior, and explicit composition. Related types/helpers may share cohesive files. Providers implement narrow capabilities; adding a provider may register a recipe without demanding a plugin marketplace or universal dependency solver.

Generate tool-owned registration/configuration files and developer-owned feature scaffolds. Protect touched paths with existence/content preconditions; do not promise arbitrary source rewriting or a general three-way merge engine. Desired JSON and realized recipe/ownership state remain distinct. Minimal init and safe incremental addition come first; all auth/database combinations and requested providers/platforms remain tracked requirements rather than scope silently removed by phases.

A narrow authentication runtime library can distribute reviewed fixes centrally. Updating that library still requires consuming projects to adopt the release, validate policy/configuration, apply necessary schema changes, and retain compatibility evidence. It does not automatically patch an entire fleet. Copied source also needs accountable advisories and migration guidance.

## Corrected security and architecture claims

- **Identifiers:** use UUIDv4 from platform cryptography. UUIDv7 exposes time/order information and introduces unnecessary clock assumptions here. Stable pagination uses explicit sort/tie-break fields.
- **Transactions:** explicit coordination and opaque context are the baseline. Async-local storage is optional plumbing, not atomicity. Conditional writes suffice for some operations; real transactions remain necessary where promised. An ORM such as TypeORM does not inherently violate purity: leaking its entities/decorators/query objects into pure owners would violate the boundary.
- **Validation:** Zod is the recommended new-blueprint schema direction, subject to exact Nest/OpenAPI/WS compatibility verification. Validation does not replace authorization, domain invariants, database constraints, or output redaction. Do not claim that a library makes arbitrary input safe or that a third-party bridge is officially maintained without checking.
- **Refresh:** local auth starts with atomic single-use opaque refresh rotation, client single-flight behavior, and reauthentication after an unrecoverable lost/ambiguous refresh response. Do not introduce an unsafe RT1-to-RT3 recovery chain or replay prior secrets merely for transparent recovery. Any future recovery protocol needs separate review.
- **Firebase:** recent authentication alone cannot stop a revoked credential from enrolling another session within the same freshness window. Enrollment must cross an atomic authority boundary with a durable revocation cutoff. Earlier discussion cited disabled-user/revocation verification behavior; exact selected SDK/version options and failure semantics must be checked in Phase 00.
- **Centrifugo:** do not forward the client-controlled name of an internal proxy-secret header. Configure and verify backend authentication without assuming static-header precedence makes duplicate or forwarded headers safe.

## Operational boundaries

Keep artifact rendering separate from authenticated platform operators for Dokploy, Coolify, and CapRover. The finite service plan describes selected services, commands, ports, secret references, health, volumes, and release jobs; it is not another orchestrator. Dev commands wrap Nest and supported service tools, without a custom daemon/supervisor. Platform operators need stale-plan checks, partial-progress reconciliation, and preserved durable state. Migration coordination is a dedicated release action, not a boot-time exactly-once promise.

Vector collects/transforms, Logdy views live output, retained evidence supports bounded queries, and assertions establish test outcomes. A separate same-user MCP process is not a sandbox. Docker socket read permissions or proxy endpoint flags do not establish project-level authorization. Stronger profiles need actual enforced identity/filesystem/network restrictions. Local evidence reading and authenticated remote queries have different network requirements. Logs remain untrusted data, and no agent instructions guarantee compliance.

Resolve remaining measured values and implementation choices through the decision register. Prefer focused counterexample tests and representative fixtures to an all-combination matrix or giant reference app. No documentation, generated class, mocked provider, or image build alone establishes production security, delivery, deployment, or recovery.
